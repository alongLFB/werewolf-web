"use client"

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { login } from "./actions";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <Card className="w-full max-w-sm rounded-lg bg-white shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={login} className="space-y-6">
            <div>
              <label htmlFor="email" className="block mb-1 text-sm font-medium">
                邮箱
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="请输入邮箱"
                className="text-base"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="password" className="block mb-1 text-sm font-medium">
                密码
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="请输入密码"
                  className="text-base pr-12"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full text-base py-2">
              登录
            </Button>
          </form>
          <div className="flex justify-between mt-6 text-sm">
            <Link href="/register" className="text-blue-600 hover:underline">
              注册账号
            </Link>
            <Link href="/forgot-password" className="text-blue-600 hover:underline">
              忘记密码？
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}