// app/api/rooms/[roomId]/night/witch-action/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/utils/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const supabase = await createServerSupabaseClient();
  const { roomId } = params;
  const body = await request.json();
  // actionType: 'save' or 'poison'
  // targetUserId: required if actionType is 'poison'
  const { actionType, targetUserId } = body;

  if (!roomId || !actionType || (actionType === 'poison' && !targetUserId)) {
    return NextResponse.json(
      {
        message: 'Room ID, Action Type, and Target (for poison) are required.',
      },
      { status: 400 }
    );
  }
  if (
    actionType !== 'save' &&
    actionType !== 'poison' &&
    actionType !== 'skip'
  ) {
    // 'skip' for explicitly doing nothing
    return NextResponse.json(
      { message: 'Invalid action type.' },
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
      room.current_night_action_phase !== 'witch'
    ) {
      return NextResponse.json(
        { message: 'Not witch action phase or invalid game state' },
        { status: 400 }
      );
    }

    // 2. 验证操作者是女巫且存活，并获取药剂状态
    const { data: witchPlayer, error: witchPlayerError } = await supabase
      .from('room_players')
      .select(
        'user_id, role, is_alive, has_used_witch_save, has_used_witch_poison'
      )
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .single();

    if (
      witchPlayerError ||
      !witchPlayer ||
      witchPlayer.role !== 'witch' ||
      !witchPlayer.is_alive
    ) {
      return NextResponse.json(
        { message: 'Forbidden: Not an active witch' },
        { status: 403 }
      );
    }

    // 3. 处理女巫动作
    let message = 'Witch action processed.';
    // Define a type for the night actions log
    interface NightActionsLog {
      [roundNumber: number]: {
        wolf_kill_target?: string;
        witch_action?: {
          type: 'save' | 'poison' | 'skip';
          saved_user_id?: string;
          poisoned_user_id?: string;
        };
      };
    }

    const currentNightLog = (room.night_actions_log || {}) as NightActionsLog;
    if (!currentNightLog[room.current_round_number]) {
      currentNightLog[room.current_round_number] = {};
    }
    const roundLog = currentNightLog[room.current_round_number];

    const playerUpdates: Partial<typeof witchPlayer> = {}; // 用于更新女巫自己的药剂状态

    if (actionType === 'save') {
      if (witchPlayer.has_used_witch_save) {
        return NextResponse.json(
          { message: 'Save potion already used.' },
          { status: 400 }
        );
      }
      // 女巫第一晚能否自救的逻辑
      const wolfKillTarget = roundLog.wolf_kill_target; // 从前面狼人阶段记录的日志获取
      if (!wolfKillTarget) {
        return NextResponse.json(
          {
            message:
              'No one was targeted by wolves tonight (or wolf action not logged).',
          },
          { status: 400 }
        );
      }
      if (
        room.current_round_number === 1 &&
        wolfKillTarget === witchPlayer.user_id
      ) {
        interface GameStartConfig {
          witch_can_self_save_first_night: boolean;
        }
        const gameConfig = room.game_start_config as GameStartConfig;
        if (
          gameConfig &&
          gameConfig.witch_can_self_save_first_night === false
        ) {
          return NextResponse.json(
            {
              message:
                'Witch cannot self-save on the first night in this mode.',
            },
            { status: 403 }
          );
        }
      }
      roundLog.witch_action = { type: 'save', saved_user_id: wolfKillTarget };
      playerUpdates.has_used_witch_save = true;
      message = 'Player saved successfully.';
    } else if (actionType === 'poison') {
      if (witchPlayer.has_used_witch_poison) {
        return NextResponse.json(
          { message: 'Poison potion already used.' },
          { status: 400 }
        );
      }
      if (roundLog.witch_action && roundLog.witch_action.type === 'save') {
        // 如果同夜已用过解药
        return NextResponse.json(
          { message: 'Cannot use poison and save in the same night.' },
          { status: 400 }
        );
      }

      // 验证目标玩家
      const { data: targetToPoison, error: targetToPoisonError } =
        await supabase
          .from('room_players')
          .select('is_alive, user_id')
          .eq('room_id', roomId)
          .eq('user_id', targetUserId)
          .single();

      if (targetToPoisonError || !targetToPoison) {
        return NextResponse.json(
          { message: 'Target for poison not found.' },
          { status: 404 }
        );
      }
      if (!targetToPoison.is_alive) {
        return NextResponse.json(
          { message: 'Cannot poison a dead player.' },
          { status: 400 }
        );
      }
      if (targetToPoison.user_id === witchPlayer.user_id) {
        return NextResponse.json(
          { message: 'Witch cannot poison herself.' },
          { status: 400 }
        );
      }

      roundLog.witch_action = {
        type: 'poison',
        poisoned_user_id: targetUserId,
      };
      playerUpdates.has_used_witch_poison = true;
      message = 'Player poisoned successfully.';
    } else if (actionType === 'skip') {
      roundLog.witch_action = { type: 'skip' };
      message = 'Witch skipped action.';
    }

    // 4. 更新女巫药剂使用状态 (如果用了药)
    if (Object.keys(playerUpdates).length > 0) {
      const { error: updateWitchStatusError } = await supabase
        .from('room_players')
        .update(playerUpdates)
        .eq('room_id', roomId)
        .eq('user_id', user.id);
      if (updateWitchStatusError) {
        console.error(
          'Error updating witch potion status:',
          updateWitchStatusError
        );
        // 这是一个内部错误，但女巫的决定可能已经记录了
      }
    }

    // 5. 更新房间状态到夜晚结束/结算阶段 (或直接进入白天宣布)
    // 在夜晚结束时，会有一个统一的结算逻辑来根据 night_actions_log 更新玩家的 is_alive
    const { error: updateRoomError } = await supabase
      .from('game_rooms')
      .update({
        // current_night_action_phase: 'night_end_resolution', // 一个用于服务器结算的阶段
        // 或者，如果简单点，直接标记夜晚结束，等待一个服务器函数或下一个API调用来结算
        status: 'police_election',
        current_night_action_phase: 'finished', // 表示所有角色行动完毕
        current_night_acting_role: null,
        night_actions_log: currentNightLog,
      })
      .eq('id', roomId);

    if (updateRoomError) {
      console.error(
        'Error updating room phase after witch action:',
        updateRoomError
      );
    }

    return NextResponse.json({ message }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json(
        { message: error.message || 'Error processing witch action' },
        { status: 500 }
      );
    } else {
      return NextResponse.json(
        { message: 'An unknown error occurred' },
        { status: 500 }
      );
    }
  }
}
