"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/utils/supabase/client";
import { ArrowLeft } from "lucide-react";

const supabase = createBrowserSupabaseClient();

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNickname] = useState("");
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  const [profileEmail, setProfileEmail] = useState(""); // State for email from profiles
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameMsg, setNicknameMsg] = useState("");
  const router = useRouter();

  useEffect(() => {
    const fetchUserDataAndProfile = async () => {
      setLoading(true);
      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError || !authData.user) {
        setError("用户未登录或获取失败，请重新登录。");
        setLoading(false);
        router.push("/login");
        return;
      }

      const currentUser = authData.user;
      setUser(currentUser);

      // Set default/fallback values from auth metadata or hardcoded defaults
      let displayNickname = currentUser.user_metadata?.nickname || "WereWolf";
      let displayEmail = currentUser.email || ""; // Fallback to auth email

      // Fetch profile from 'profiles' table
      // Assumes 'id' in 'profiles' table is the foreign key to 'auth.users.id'
      // Assumes 'profiles' table has 'nickname' and 'email' columns
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('nickname, email') // Select nickname and email
        .eq('id', currentUser.id)   // Filter by current user's ID
        .single();                   // Expect a single record or null

      if (profileError && profileError.code !== 'PGRST116') { 
        // PGRST116 means no rows found, which is acceptable if a profile hasn't been created yet.
        console.warn("获取个人资料失败: ", profileError.message);
        // setError("获取个人资料失败: " + profileError.message); // Optionally set error state
      } else if (profileData) {
        // If profile data exists and is not null, use it
        displayNickname = profileData.nickname || displayNickname;
        displayEmail = profileData.email || displayEmail; // Use 'email' from profiles
      }
      
      setNickname(displayNickname);
      setNicknameInput(displayNickname);
      setProfileEmail(displayEmail); // Set the email to be displayed
      setLoading(false);
    };

    fetchUserDataAndProfile();
    
    // The following lines from your original code are removed as their logic is now integrated above:
    // supabase.auth.getUser().then(({ data }) => {
    //   setUser(data.user);
    //   setNickname(data.user?.user_metadata?.nickname || "WereWolf");
    //   setNicknameInput(data.user?.user_metadata?.nickname || "WereWolf");
    // });
    // const { data: profiles, error } = await supabase // This was incorrect
    // .from('profiles')
    // .select('*')
        
  }, [router]);

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
    if (!user) {
      setError("用户未找到，无法修改昵称。");
      return;
    }
    setNicknameLoading(true);
    setNicknameMsg("");
    setError("");

    // Update nickname in the 'profiles' table
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({ nickname: nicknameInput })
      .eq('id', user.id);

    if (profileUpdateError) {
      setError("修改昵称失败（数据库）: " + profileUpdateError.message);
      setNicknameLoading(false);
      return;
    }

    // Optionally, also update auth user metadata for consistency
    const { error: authUpdateError } = await supabase.auth.updateUser({
      data: { nickname: nicknameInput },
    });

    setNicknameLoading(false);
    if (authUpdateError) {
      // Log or handle auth update error, but profile was updated.
      console.warn("昵称已在数据库更新，但同步至认证服务失败: " + authUpdateError.message);
      setNickname(nicknameInput);
      setEditingNickname(false);
      setNicknameMsg("昵称修改成功！（认证信息同步可能稍有延迟）");
      setTimeout(() => setNicknameMsg(""), 3000);
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
        <CardHeader className="relative">
          <button
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-gray-500 hover:text-black"
            onClick={() => router.push("/")}
            aria-label="返回首页"
          >
            <ArrowLeft size={26} />
          </button>
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
                      onChange={(e) => setNicknameInput(e.target.value)}
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
              <h1 className="text-2xl font-bold mb-2">{profileEmail}</h1> {/* Use profileEmail state here */}
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
                  onChange={(e) => setNewPassword(e.target.value)}
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
