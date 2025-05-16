import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/utils/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const supabase = await createServerSupabaseClient();
  const { roomId } = params;

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // 1. Validate room status
    const { data: room, error: roomError } = await supabase
      .from('game_rooms')
      .select('status')
      .eq('id', roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ message: 'Room not found' }, { status: 404 });
    }
    if (room.status !== 'police_election') {
      return NextResponse.json(
        { message: 'Not in police election phase' },
        { status: 400 }
      );
    }

    // 2. Validate player status
    const { data: player, error: playerError } = await supabase
      .from('room_players')
      .select('is_alive, is_candidate_for_sheriff')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .single();

    if (playerError || !player) {
      return NextResponse.json(
        { message: 'Player not found in this room' },
        { status: 404 }
      );
    }
    if (!player.is_alive) {
      return NextResponse.json(
        { message: 'Dead players cannot run for sheriff' },
        { status: 403 }
      );
    }
    if (player.is_candidate_for_sheriff) {
      return NextResponse.json(
        { message: 'Player is already a candidate' },
        { status: 400 }
      );
    }

    // 3. Update player to be a candidate
    const { error: updateError } = await supabase
      .from('room_players')
      .update({ is_candidate_for_sheriff: true })
      .eq('room_id', roomId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error updating player to candidate:', updateError);
      return NextResponse.json(
        { message: `Failed to run for sheriff: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Successfully ran for sheriff.' },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('Error in run-for-sheriff:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
