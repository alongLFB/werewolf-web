// app/api/rooms/[roomId]/night/wolf-kill/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/utils/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const supabase = await createServerSupabaseClient();
  const { roomId } = params;
  const body = await request.json();
  const { targetUserId } = body; // 前端传来目标玩家的 user_id

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // 1. 验证当前玩家是狼人且存活，并且游戏处于狼人行动阶段
    const { data: room, error: roomError } = await supabase
      .from("game_rooms")
      .select(
        "status, current_round_number, current_night_action_phase, night_actions_log"
      )
      .eq("id", roomId)
      .single();

    if (roomError || !room)
      return NextResponse.json({ message: "Room not found" }, { status: 404 });
    if (
      room.status !== "in_game_night" ||
      room.current_night_action_phase !== "wolf"
    ) {
      return NextResponse.json(
        { message: "Not wolf action phase" },
        { status: 400 }
      );
    }

    const { data: actingPlayer, error: playerError } = await supabase
      .from("room_players")
      .select("role, is_alive")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .single();

    if (
      playerError ||
      !actingPlayer ||
      actingPlayer.role !== "wolf" ||
      !actingPlayer.is_alive
    ) {
      return NextResponse.json(
        { message: "Forbidden: Not an active wolf" },
        { status: 403 }
      );
    }

    // 2. 验证目标玩家存在且存活 (通常狼人不能刀自己，但同伴可以)
    const { data: targetPlayer, error: targetPlayerError } = await supabase
      .from("room_players")
      .select("is_alive, user_id")
      .eq("room_id", roomId)
      .eq("user_id", targetUserId)
      .single();

    if (targetPlayerError || !targetPlayer || !targetPlayer.is_alive) {
      return NextResponse.json(
        { message: "Invalid or dead target" },
        { status: 400 }
      );
    }
    // （可选）如果需要所有狼人确认，这里的逻辑会更复杂，可能需要一个临时的狼人投票表
    // 这里简化为单个狼人提交即代表狼队意见，或者前端已做同步

    // 3. 更新房间的夜间行动日志 (记录狼刀目标)
    type NightActionsLog = Record<number, { wolf_kill_target?: string }>;
    const currentNightLog = (room.night_actions_log || {}) as NightActionsLog;
    if (!currentNightLog[room.current_round_number]) {
      currentNightLog[room.current_round_number] = {};
    }
    currentNightLog[room.current_round_number].wolf_kill_target = targetUserId;
    // 也可以记录是谁操作的 (如果需要区分狼人)
    // currentNightLog[room.current_round_number].wolf_actors = [...(currentNightLog[room.current_round_number].wolf_actors || []), user.id];

    // 4. 更新房间状态到下一个夜间行动者 (预言家)
    const { error: updateRoomError } = await supabase
      .from("game_rooms")
      .update({
        current_night_action_phase: "seer",
        current_night_acting_role: "seer",
        night_actions_log: currentNightLog,
      })
      .eq("id", roomId);

    if (updateRoomError) throw updateRoomError;

    // 5. (可选) 给其他狼人广播刀人目标已确认 (如果他们需要知道)
    // supabase.channel(`room-${roomId}`).send({...});

    return NextResponse.json(
      { message: "Wolf kill target registered." },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json(
        { message: error.message || "Error processing wolf kill" },
        { status: 500 }
      );
    } else {
      return NextResponse.json(
        { message: "An unknown error occurred" },
        { status: 500 }
      );
    }
  }
}
