import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/utils/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const supabase = await createServerSupabaseClient();
  const { roomId } = params;
  const body = await request.json();
  const { direction } = body as {
    direction: 'clockwise' | 'counter_clockwise';
  };

  if (
    !direction ||
    (direction !== 'clockwise' && direction !== 'counter_clockwise')
  ) {
    return NextResponse.json(
      { message: 'Invalid direction provided.' },
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

    // 1. Validate room, status, and if current user is sheriff
    const { data: room, error: roomError } = await supabase
      .from('game_rooms')
      .select('status, police_badge_holder_id, current_round_number')
      .eq('id', roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ message: 'Room not found' }, { status: 404 });
    }
    if (room.status !== 'sheriff_sets_speech_order') {
      return NextResponse.json(
        { message: 'Not in sheriff sets speech order phase' },
        { status: 400 }
      );
    }
    if (room.police_badge_holder_id !== user.id) {
      return NextResponse.json(
        { message: 'Forbidden: Only the sheriff can set speech order' },
        { status: 403 }
      );
    }

    // 2. Get alive players sorted by seat number
    const { data: alivePlayers, error: playersError } = await supabase
      .from('room_players')
      .select('user_id, seat_number')
      .eq('room_id', roomId)
      .eq('is_alive', true)
      .order('seat_number', { ascending: true });

    if (playersError || !alivePlayers || alivePlayers.length === 0) {
      return NextResponse.json(
        { message: 'Could not fetch alive players or no alive players found' },
        { status: 500 }
      );
    }

    // 3. Calculate speaker order
    const sheriffIndex = alivePlayers.findIndex((p) => p.user_id === user.id);
    if (sheriffIndex === -1) {
      return NextResponse.json(
        { message: 'Sheriff not found among alive players.' },
        { status: 500 }
      );
    }

    const speakerOrderIds: string[] = [];
    if (direction === 'clockwise') {
      for (let i = 0; i < alivePlayers.length; i++) {
        speakerOrderIds.push(
          alivePlayers[(sheriffIndex + i) % alivePlayers.length].user_id
        );
      }
    } else {
      // counter-clockwise
      for (let i = 0; i < alivePlayers.length; i++) {
        speakerOrderIds.push(
          alivePlayers[
            (sheriffIndex - i + alivePlayers.length) % alivePlayers.length
          ].user_id
        );
      }
    }

    const firstSpeakerId =
      speakerOrderIds.length > 0 ? speakerOrderIds[0] : null;

    // 4. Update game_rooms
    const { error: updateRoomError } = await supabase
      .from('game_rooms')
      .update({
        status: 'in_game_day_discussion',
        speaker_order: speakerOrderIds,
        current_turn_player_id: firstSpeakerId,
        current_round_number: room.current_round_number + 1, // Increment round as day starts
      })
      .eq('id', roomId);

    if (updateRoomError) {
      console.error('Error setting speech order:', updateRoomError);
      return NextResponse.json(
        { message: `Failed to set speech order: ${updateRoomError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Speech order set. Transitioning to day discussion.' },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('Error in set-speech-order:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
