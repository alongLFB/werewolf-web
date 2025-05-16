import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/utils/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const supabase = await createServerSupabaseClient();
  const { roomId } = params;
  const body = await request.json();
  const { candidateUserId } = body;

  if (!candidateUserId) {
    return NextResponse.json(
      { message: 'Candidate User ID is required.' },
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

    // 2. Validate voting player status
    const { data: votingPlayer, error: votingPlayerError } = await supabase
      .from('room_players')
      .select('is_alive, voted_for_sheriff_candidate_id')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .single();

    if (votingPlayerError || !votingPlayer) {
      return NextResponse.json(
        { message: 'Player not found in this room' },
        { status: 404 }
      );
    }
    if (!votingPlayer.is_alive) {
      return NextResponse.json(
        { message: 'Dead players cannot vote' },
        { status: 403 }
      );
    }
    if (votingPlayer.voted_for_sheriff_candidate_id) {
      return NextResponse.json(
        { message: 'Player has already voted' },
        { status: 400 }
      );
    }

    // 3. Validate candidate status
    const { data: candidatePlayer, error: candidatePlayerError } =
      await supabase
        .from('room_players')
        .select('is_alive, is_candidate_for_sheriff')
        .eq('room_id', roomId)
        .eq('user_id', candidateUserId)
        .single();

    if (candidatePlayerError || !candidatePlayer) {
      return NextResponse.json(
        { message: 'Candidate not found' },
        { status: 404 }
      );
    }
    if (
      !candidatePlayer.is_alive ||
      !candidatePlayer.is_candidate_for_sheriff
    ) {
      return NextResponse.json(
        { message: 'Invalid candidate' },
        { status: 400 }
      );
    }

    // 4. Update player's vote
    const { error: updateError } = await supabase
      .from('room_players')
      .update({ voted_for_sheriff_candidate_id: candidateUserId })
      .eq('room_id', roomId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error updating player vote:', updateError);
      return NextResponse.json(
        { message: `Failed to vote: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Successfully voted for sheriff.' },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('Error in vote-for-sheriff:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
