"use client";

import { useState } from 'react';

interface JoinRoomFormProps {
  onSubmit: (inviteCode: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const JoinRoomForm: React.FC<JoinRoomFormProps> = ({ onSubmit, isLoading, error }) => {
  const [inviteCode, setInviteCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) {
      // setError in parent or handle here
      return;
    }
    onSubmit(inviteCode);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
      <div className="mb-6">
        <label htmlFor="invite-code" className="block text-sm font-medium text-gray-700">
          房间邀请码 (6位)
        </label>
        <input
          type="text"
          id="invite-code"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          maxLength={6}
          className="mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm uppercase"
          placeholder="例如: XYZ123"
          disabled={isLoading}
        />
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <button
        type="submit"
        disabled={isLoading || !inviteCode.trim()}
        className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
      >
        {isLoading ? '加入中...' : '确认加入'}
      </button>
    </form>
  );
};

export default JoinRoomForm;