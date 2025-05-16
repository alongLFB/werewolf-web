import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/utils/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { inviteCode } = body;

    if (
      !inviteCode ||
      typeof inviteCode !== 'string' ||
      inviteCode.length !== 6
    ) {
      return NextResponse.json(
        { message: 'Invalid invite code format.' },
        { status: 400 }
      );
    }

    // 1. 查找房间
    const { data: room, error: roomError } = await supabase
      .from('game_rooms')
      .select('id, status, host_user_id')
      .eq('invite_code', inviteCode.toUpperCase())
      .single(); // Use .single() if you expect exactly one or an error

    if (roomError) {
      // This will catch if no room is found (PostgREST error) or other DB errors
      console.error('Error fetching room:', roomError);
      if (roomError.code === 'PGRST116') {
        // PostgREST code for " esattamente una riga prevista, ma 0 ne sono state trovate" (exactly one row expected, but 0 were found)
        return NextResponse.json(
          { message: 'Room not found with this invite code.' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { message: 'Database error fetching room.' },
        { status: 500 }
      );
    }
    // If .single() is used, and no room, it throws. If .maybeSingle(), then !room check is needed.
    // For .single(), if it doesn't throw, room is guaranteed.

    if (room.status !== 'lobby') {
      return NextResponse.json(
        { message: 'This game is already in progress or finished.' },
        { status: 403 }
      );
    }

    // 2. 检查玩家是否已在该房间
    const { data: existingPlayer, error: playerCheckError } = await supabase
      .from('room_players')
      .select('id')
      .eq('room_id', room.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (playerCheckError) {
      console.error('Error checking existing player:', playerCheckError);
      return NextResponse.json(
        { message: 'Error checking player status.' },
        { status: 500 }
      );
    }
    if (existingPlayer) {
      return NextResponse.json(
        { roomId: room.id, message: 'Already in room.' },
        { status: 200 }
      );
    }

    // 3. 检查房间人数
    const { count: playerCount, error: countError } = await supabase
      .from('room_players')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id);

    if (countError) {
      console.error('Error counting players:', countError);
      return NextResponse.json(
        { message: 'Error checking room capacity.' },
        { status: 500 }
      );
    }

    if (playerCount !== null && playerCount >= 9) {
      return NextResponse.json({ message: 'Room is full.' }, { status: 403 });
    }

    // 4. 将玩家加入 room_players
    const { data: newPlayer, error: insertPlayerError } = await supabase
      .from('room_players')
      .insert({
        room_id: room.id,
        user_id: user.id,
        is_ready: false,
      })
      .select('id') // Select something to confirm insertion
      .single();

    if (insertPlayerError) {
      console.error('Supabase insert player error:', insertPlayerError);
      return NextResponse.json(
        { message: insertPlayerError.message || 'Failed to add player' },
        { status: 500 }
      );
    }
    if (!newPlayer) {
      return NextResponse.json(
        { message: 'Player added but no data returned.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ roomId: room.id }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('API Error /api/rooms/create:', error.message);
    } else {
      console.error('API Error /api/rooms/create:', error);
    }
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : 'Internal Server Error',
      },
      { status: 500 }
    );
  }
}
