'use client';

import { useState } from 'react';

interface CreateRoomFormProps {
  onSubmit: (gameSettingsChoice: 'A' | 'B') => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const CreateRoomForm: React.FC<CreateRoomFormProps> = ({
  onSubmit,
  isLoading,
  error,
}) => {
  const [gameSettingsChoice, setGameSettingsChoice] = useState<'A' | 'B'>('A');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(gameSettingsChoice);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md bg-white p-8 rounded-lg shadow-md"
    >
      <div className="mb-6">
        <label
          htmlFor="gameSettings"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          游戏模式选择:
        </label>
        <select
          id="gameSettings"
          value={gameSettingsChoice}
          onChange={(e) => setGameSettingsChoice(e.target.value as 'A' | 'B')}
          className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          disabled={isLoading}
        >
          <option value="A">模式A (有警长, 女巫首夜不可自救)</option>
          <option value="B">模式B (无警长, 女巫首夜可自救)</option>
        </select>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {isLoading ? '创建中...' : '确认创建'}
      </button>
    </form>
  );
};

export default CreateRoomForm;
