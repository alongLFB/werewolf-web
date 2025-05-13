"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNickname] = useState("");
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameMsg, setNicknameMsg] = useState("");
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setNickname(data.user?.user_metadata?.nickname || "WereWolf");
      setNicknameInput(data.user?.user_metadata?.nickname || "WereWolf");
    });
  }, []);

  // 修改密码
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) setError(error.message);
    else {
      setMessage("密码修改成功，请重新登录。");
      setTimeout(() => {
        supabase.auth.signOut();
        router.push("/login");
      }, 1500);
    }
  };

  // 修改昵称
  const handleNicknameSave = async () => {
    setNicknameLoading(true);
    setNicknameMsg("");
    setError("");
    const { error } = await supabase.auth.updateUser({
      data: { nickname: nicknameInput },
    });
    setNicknameLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setNickname(nicknameInput);
      setEditingNickname(false);
      setNicknameMsg("昵称修改成功！");
      setTimeout(() => setNicknameMsg(""), 2000);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <Card className="w-full max-w-sm rounded-lg bg-white shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">
            个人资料
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div>
              <label className="block mb-1 text-sm font-medium">昵称</label>
              <div className="flex items-center gap-2">
                {editingNickname ? (
                  <>
                    <Input
                      value={nicknameInput}
                      onChange={e => setNicknameInput(e.target.value)}
                      className="text-base"
                      disabled={nicknameLoading}
                    />
                    <Button
                      size="sm"
                      onClick={handleNicknameSave}
                      disabled={nicknameLoading || !nicknameInput.trim()}
                    >
                      保存
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingNickname(false);
                        setNicknameInput(nickname);
                      }}
                      disabled={nicknameLoading}
                    >
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    <h1 className="text-2xl font-bold mb-2">{nickname}</h1>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingNickname(true)}
                    >
                      编辑
                    </Button>
                  </>
                )}
              </div>
              {nicknameMsg && (
                <p className="text-green-600 text-sm mt-1">{nicknameMsg}</p>
              )}
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium">邮箱</label>
              <h1 className="text-2xl font-bold mb-2">{user?.email}</h1>
            </div>
            <form className="space-y-4" onSubmit={handlePasswordChange}>
              <label className="block mb-1 text-sm font-medium">修改密码</label>
              <div className="relative">
                <Input
                  id="new-password"
                  name="new-password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="请输入新密码"
                  className="text-base pr-12"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  disabled={loading}
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loading || !newPassword}
              >
                {loading ? "修改中..." : "修改密码"}
              </Button>
              {message && (
                <p className="text-green-600 text-center text-sm">{message}</p>
              )}
              {error && (
                <p className="text-red-500 text-center text-sm">{error}</p>
              )}
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}