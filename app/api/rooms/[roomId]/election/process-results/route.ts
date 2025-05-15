import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/utils/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const supabase = await createServerSupabaseClient();
  const { roomId } = params;

  try {
    const {
      data: { user }, // User for host check
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // 1. Validate room and host
    const { data: room, error: roomError } = await supabase
      .from("game_rooms")
      .select("status, host_user_id, night_actions_log, current_round_number")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ message: "Room not found" }, { status: 404 });
    }
    // if (room.host_user_id !== user.id) { // Optional: only host can trigger
    //   return NextResponse.json({ message: "Forbidden: Only host can process results" }, { status: 403 });
    // }
    if (room.status !== "police_election") {
      return NextResponse.json(
        { message: "Not in police election phase" },
        { status: 400 }
      );
    }

    // 2. Fetch all players to calculate votes and process deaths
    const { data: players, error: playersError } = await supabase
      .from("room_players")
      .select(
        "user_id, is_alive, is_candidate_for_sheriff, voted_for_sheriff_candidate_id"
      )
      .eq("room_id", roomId);

    if (playersError || !players) {
      return NextResponse.json(
        { message: "Could not fetch players" },
        { status: 500 }
      );
    }

    // 3. Calculate votes
    const voteCounts: Record<string, number> = {};
    players.forEach((p) => {
      if (p.is_alive && p.voted_for_sheriff_candidate_id) {
        voteCounts[p.voted_for_sheriff_candidate_id] =
          (voteCounts[p.voted_for_sheriff_candidate_id] || 0) + 1;
      }
    });

    let sheriffId: string | null = null;
    let maxVotes = 0;
    let tied = false;
    for (const candidateId in voteCounts) {
      if (voteCounts[candidateId] > maxVotes) {
        maxVotes = voteCounts[candidateId];
        sheriffId = candidateId;
        tied = false;
      } else if (voteCounts[candidateId] === maxVotes && maxVotes > 0) {
        tied = true;
      }
    }
    if (tied) sheriffId = null; // No sheriff on tie

    // 4. Process night deaths
    interface NightActionLog {
      wolf_kill_target: string;
      witch_action: {
        type: 'save' | 'poison' | 'skip';
        saved_user_id?: string;
        poisoned_user_id?: string;
      };
    }
    const nightLog = (room.night_actions_log || {}) as Record<number, NightActionLog>;
    const currentRoundLog = nightLog[room.current_round_number] || {};

    const wolfTarget = currentRoundLog.wolf_kill_target;
    const witchAction = currentRoundLog.witch_action || {}; // { type: 'save'|'poison'|'skip', saved_user_id, poisoned_user_id }

    const deathsTonight = new Set<string>();

    if (wolfTarget) {
      if (
        !(
          witchAction.type === "save" &&
          witchAction.saved_user_id === wolfTarget
        )
      ) {
        deathsTonight.add(wolfTarget);
      }
    }
    if (witchAction.type === "poison" && witchAction.poisoned_user_id) {
      deathsTonight.add(witchAction.poisoned_user_id);
    }

    const lastNightDeathsArray = Array.from(deathsTonight);

    // Update player statuses for deaths
    if (lastNightDeathsArray.length > 0) {
      const { error: updateDeathsError } = await supabase
        .from("room_players")
        .update({ is_alive: false })
        .eq("room_id", roomId)
        .in("user_id", lastNightDeathsArray);

      if (updateDeathsError) {
        console.error("Error updating deceased players:", updateDeathsError);
        // Continue, but log the error
      }
    }

    // 5. Update game_rooms table
    const { error: updateRoomError } = await supabase
      .from("game_rooms")
      .update({
        status: "day_results_announcement",
        police_badge_holder_id: sheriffId,
        last_night_deaths: lastNightDeathsArray,
        // Optionally, reset election fields on room_players in a separate call or trigger
        // current_round_number: room.current_round_number + 1, // Or increment later
      })
      .eq("id", roomId);

    if (updateRoomError) {
      console.error("Error updating room for results:", updateRoomError);
      return NextResponse.json(
        { message: `Failed to process results: ${updateRoomError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Election results processed, deaths recorded." },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("Error in process-results:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { message: errorMessage },
      { status: 500 }
    );
  }
}
