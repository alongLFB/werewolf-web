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
      data: { user }, // Optional: for host check
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { data: room, error: roomError } = await supabase
      .from("game_rooms")
      .select("status, host_user_id, police_badge_holder_id")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ message: "Room not found" }, { status: 404 });
    }
    // if (room.host_user_id !== user.id) { // Optional host check
    //   return NextResponse.json({ message: "Forbidden: Only host can proceed" }, { status: 403 });
    // }
    if (room.status !== "day_results_announcement") {
      return NextResponse.json(
        { message: "Not in day results announcement phase" },
        { status: 400 }
      );
    }

    let nextStatus = "in_game_day_discussion";
    if (room.police_badge_holder_id) {
      nextStatus = "sheriff_sets_speech_order";
    }
    // If no sheriff, and you need to set a default speaker order, do it here.
    // For simplicity, we assume day_discussion phase will handle speaker order if no sheriff.

    const { error: updateRoomError } = await supabase
      .from("game_rooms")
      .update({ status: nextStatus })
      .eq("id", roomId);

    if (updateRoomError) {
      console.error("Error proceeding to next phase:", updateRoomError);
      return NextResponse.json(
        { message: `Failed to proceed: ${updateRoomError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: `Proceeded to ${nextStatus}.` },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("Error in proceed-to-sheriff-order:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { message: errorMessage },
      { status: 500 }
    );
  }
}
