// app/api/rooms/[roomId]/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/utils/supabase/server";

// 角色配置 (9人标准局)
const ROLES_CONFIG_9_PLAYERS = [
  "wolf",
  "wolf",
  "wolf",
  "seer",
  "witch",
  "hunter",
  "villager",
  "villager",
  "villager",
];

// 洗牌函数 (Fisher-Yates shuffle)
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } } // 获取动态路由参数 roomId
) {
  const supabase = await createServerSupabaseClient();
  const roomId = params.roomId;

  if (!roomId) {
    return NextResponse.json(
      { message: "Room ID is required." },
      { status: 400 }
    );
  }

  try {
    // 1. 验证用户身份 (是否登录)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { message: "Unauthorized: User not authenticated." },
        { status: 401 }
      );
    }

    // 2. 获取房间信息，并验证操作者是否为房主
    const { data: room, error: roomError } = await supabase
      .from("game_rooms")
      .select("id, host_user_id, status, game_settings_choice")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json(
        { message: "Room not found or database error." },
        { status: 404 }
      );
    }

    if (room.host_user_id !== user.id) {
      return NextResponse.json(
        { message: "Forbidden: Only the host can start the game." },
        { status: 403 }
      );
    }

    if (room.status !== "lobby") {
      return NextResponse.json(
        { message: "Game cannot be started. Invalid room status." },
        { status: 400 }
      );
    }

    // 3. 获取房间内所有玩家
    const { data: players, error: playersError } = await supabase
      .from("room_players")
      .select("id, user_id, is_ready, seat_number") // room_players.id 是主键, user_id 是关联 users 的
      .eq("room_id", roomId);

    if (playersError || !players) {
      return NextResponse.json(
        { message: "Failed to fetch players or no players in room." },
        { status: 500 }
      );
    }

    // 4. 验证开始条件 (例如: 9人, 都已选座, 都已准备)
    if (players.length !== 9) {
      return NextResponse.json(
        {
          message: `Cannot start game: Expected 9 players, found ${players.length}.`,
        },
        { status: 400 }
      );
    }
    if (players.some((p) => p.seat_number === null)) {
      return NextResponse.json(
        { message: "Cannot start game: Not all players have selected a seat." },
        { status: 400 }
      );
    }
    // 准备状态检查 (根据你的业务逻辑，是否强制所有人都准备)
    if (players.some((p) => !p.is_ready)) {
      return NextResponse.json(
        { message: "Cannot start game: Not all players are ready." },
        { status: 400 }
      );
    }

    // 5. 分配角色
    const shuffledRoles = shuffleArray(ROLES_CONFIG_9_PLAYERS);
    const playerUpdates = players.map((player, index) => ({
      // where: { id: player.id }, // 如果用 updateMany, 但这里分开 update 或 upsert 更直观
      // data: { role: shuffledRoles[index] },
      room_id: roomId, // 用于 upsert 的匹配或 update 的条件
      user_id: player.user_id, // 用于 upsert 的匹配或 update 的条件
      role: shuffledRoles[index],
      // 重置一些游戏开始时的状态 (如果需要)
      is_alive: true,
      has_used_witch_save: false, // 根据游戏开始配置决定
      has_used_witch_poison: false,
      can_hunter_shoot: true, //猎人初始可开枪
      votes_received_this_round: 0,
      wants_to_be_sheriff: false,
    }));

    // 更新 room_players 表 (使用 upsert 或逐条 update)
    // 使用 upsert 比较好，如果记录存在则更新，不存在则插入（虽然理论上此时记录应该都存在）
    // 或者，因为我们已经获取了 players，可以直接用循环 update
    for (const update of playerUpdates) {
      const { error: updatePlayerError } = await supabase
        .from("room_players")
        .update({
          role: update.role,
          is_alive: update.is_alive,
          has_used_witch_save: update.has_used_witch_save,
          has_used_witch_poison: update.has_used_witch_poison,
          can_hunter_shoot: update.can_hunter_shoot,
          votes_received_this_round: update.votes_received_this_round,
          wants_to_be_sheriff: update.wants_to_be_sheriff,
        })
        .eq("room_id", roomId)
        .eq("user_id", update.user_id); // 确保更新正确的玩家

      if (updatePlayerError) {
        console.error(
          `Error updating player ${update.user_id} role:`,
          updatePlayerError
        );
        // 根据业务决定是否需要回滚或强行继续
        return NextResponse.json(
          {
            message: `Failed to update player roles: ${updatePlayerError.message}`,
          },
          { status: 500 }
        );
      }
    }

    // 6. 更新 game_rooms 表状态
    const gameStartConfig = {
      // 你可以根据 game_settings_choice 决定女巫第一晚能否自救等
      witch_first_night_can_self_save: room.game_settings_choice === "B", // 假设 B 模式可以
    };

    const { error: updateRoomError } = await supabase
      .from("game_rooms")
      .update({
        status: "in_game_night", // 直接进入夜晚
        current_round_number: 1,
        game_started_at: new Date().toISOString(),
        police_badge_holder_id: null, // 清空警长
        speaker_order: null, // 清空发言顺序
        game_start_config: gameStartConfig, // 存储游戏开始时的配置
        current_night_action_phase: "wolf", // Set initial night phase to wolf
        current_night_acting_role: "wolf", // Set initial acting role to wolf
      })
      .eq("id", roomId);

    if (updateRoomError) {
      console.error("Error updating game room status:", updateRoomError);
      return NextResponse.json(
        { message: `Failed to update game status: ${updateRoomError.message}` },
        { status: 500 }
      );
    }

    // 7. （可选）发送一个 Realtime Broadcast 事件通知游戏开始
    // await supabase.channel(`room-${roomId}`).send({
    //   type: 'broadcast',
    //   event: 'game_started',
    //   payload: { message: '游戏已开始！天黑请闭眼...' }
    // });

    return NextResponse.json(
      { message: "Game started successfully!" },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("API Error /api/rooms/[roomId]/start:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
