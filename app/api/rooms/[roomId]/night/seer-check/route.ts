// app/api/rooms/[roomId]/night/seer-check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/utils/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const supabase = await createServerSupabaseClient();
  const { roomId } = params;
  const body = await request.json();
  const { targetUserId } = body; // 前端传来被查验玩家的 user_id

  if (!roomId || !targetUserId) {
    return NextResponse.json(
      { message: 'Room ID and Target User ID are required.' },
      { status: 400 }
    );
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // 1. 验证房间和游戏阶段
    const { data: room, error: roomError } = await supabase
      .from('game_rooms')
      .select(
        'status, current_round_number, current_night_action_phase, night_actions_log, game_start_config'
      )
      .eq('id', roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ message: 'Room not found' }, { status: 404 });
    }
    if (
      room.status !== 'in_game_night' ||
      room.current_night_action_phase !== 'seer'
    ) {
      return NextResponse.json(
        { message: 'Not seer action phase or invalid game state' },
        { status: 400 }
      );
    }

    // 2. 验证操作者是预言家且存活
    const { data: seerPlayer, error: seerPlayerError } = await supabase
      .from('room_players')
      .select('role, is_alive')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .single();

    if (
      seerPlayerError ||
      !seerPlayer ||
      seerPlayer.role !== 'seer' ||
      !seerPlayer.is_alive
    ) {
      return NextResponse.json(
        { message: 'Forbidden: Not an active seer' },
        { status: 403 }
      );
    }

    // 3. 获取被查验玩家的角色
    const { data: targetPlayer, error: targetPlayerError } = await supabase
      .from('room_players')
      .select('user_id, role, is_alive') // is_alive 可以用来给预言家提示，但查验结果按实际角色
      .eq('room_id', roomId)
      .eq('user_id', targetUserId)
      .single();

    if (targetPlayerError || !targetPlayer) {
      return NextResponse.json(
        { message: 'Target player not found' },
        { status: 404 }
      );
    }

    // 4. 判断查验结果 (狼人视为'wolf', 其他好人阵营角色和神职视为'good')
    const roleChecked = targetPlayer.role === 'wolf' ? 'wolf' : 'good';

    // 5. (可选) 记录查验动作到 night_actions_log
    type NightActionsLog = {
      [roundNumber: number]: {
        seer_check?: {
          seer_id: string;
          target_id: string;
          result: 'wolf' | 'good';
          target_is_alive: boolean;
        };
      };
    };

    const currentNightLog = (room.night_actions_log || {}) as NightActionsLog;
    if (!currentNightLog[room.current_round_number]) {
      currentNightLog[room.current_round_number] = {};
    }
    currentNightLog[room.current_round_number].seer_check = {
      seer_id: user.id,
      target_id: targetUserId,
      result: roleChecked,
      target_is_alive: targetPlayer.is_alive,
    };

    // 6. 更新房间状态到下一个夜间行动者 (女巫)
    const { error: updateRoomError } = await supabase
      .from('game_rooms')
      .update({
        current_night_action_phase: 'witch',
        current_night_acting_role: 'witch',
        night_actions_log: currentNightLog,
      })
      .eq('id', roomId);

    if (updateRoomError) {
      console.error(
        'Error updating room phase after seer check:',
        updateRoomError
      );
      // 即使这里失败，验人结果也应该返回给预言家
    }

    // 7. 将验人结果直接返回给预言家 (或者通过私密 Broadcast)
    // 前端在收到这个响应后，更新自己的 nightActions state
    return NextResponse.json(
      {
        message: 'Seer check successful.',
        checkedUserId: targetUserId,
        roleChecked: roleChecked, // 'wolf' or 'good'
        targetIsAlive: targetPlayer.is_alive, // 额外信息
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('Seer check API error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Error processing seer check';
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
