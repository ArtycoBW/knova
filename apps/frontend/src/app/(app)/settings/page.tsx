"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Download,
  ImagePlus,
  Lock,
  Mic,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-auth";
import { usePwa } from "@/hooks/use-pwa";
import {
  useCurrentLlmProvider,
  useLlmProviders,
  useSwitchLlmProvider,
} from "@/hooks/use-settings";
import {
  useChangePassword,
  useUploadAvatar,
  useUpdateProfile,
} from "@/hooks/use-users";

const roles = [
  { value: "STUDENT", label: "Студент" },
  { value: "SCIENTIST", label: "Исследователь" },
  { value: "OFFICIAL", label: "Менеджер" },
  { value: "OTHER", label: "Другое" },
];

export default function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { data: me } = useMe();
  const currentProvider = useCurrentLlmProvider();
  const providers = useLlmProviders();
  const switchProvider = useSwitchLlmProvider();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const changePassword = useChangePassword();
  const pwa = usePwa();

  const [profile, setProfile] = useState({
    firstName: "",
    lastName: "",
    organization: "",
    role: "OTHER",
    bio: "",
  });
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
  });

  useEffect(() => {
    if (!me) {
      return;
    }

    setProfile({
      firstName: me.firstName ?? "",
      lastName: me.lastName ?? "",
      organization: me.organization ?? "",
      role: me.role ?? "OTHER",
      bio: me.bio ?? "",
    });
  }, [me]);

  const handleProfileSave = async () => {
    await updateProfile.mutateAsync({
      firstName: profile.firstName.trim() || undefined,
      lastName: profile.lastName.trim() || undefined,
      organization: profile.organization.trim() || undefined,
      role: profile.role as "STUDENT" | "SCIENTIST" | "OFFICIAL" | "OTHER",
      bio: profile.bio.trim() || undefined,
    });
  };

  const handlePasswordSave = async () => {
    await changePassword.mutateAsync(passwords);
    setPasswords({
      currentPassword: "",
      newPassword: "",
    });
  };

  const activeProvider = currentProvider.data?.provider;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-2">
        <h1 className="font-[Syne] text-3xl font-bold">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          Управляйте профилем, AI-провайдерами и установкой приложения на устройство.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-primary/15">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" />
              Профиль пользователя
            </CardTitle>
            <CardDescription>
              Обновите имя, роль, описание и аватар, которые отображаются в интерфейсе.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              {me?.avatarUrl ? (
                <img
                  src={me.avatarUrl}
                  alt="Аватар"
                  className="h-20 w-20 rounded-3xl border border-border object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-border bg-primary/10 text-2xl font-semibold text-primary">
                  {me?.firstName?.[0] ?? me?.email?.[0]?.toUpperCase() ?? "K"}
                </div>
              )}

              <div className="space-y-2">
                <div>
                  <p className="font-medium text-foreground">
                    {me?.firstName || me?.lastName
                      ? `${me?.firstName ?? ""} ${me?.lastName ?? ""}`.trim()
                      : me?.email}
                  </p>
                  <p className="text-sm text-muted-foreground">{me?.email}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadAvatar.isPending}
                >
                  {uploadAvatar.isPending ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="mr-2 h-4 w-4" />
                  )}
                  Загрузить аватар
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      uploadAvatar.mutate(file);
                    }
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Имя</label>
                <Input
                  value={profile.firstName}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, firstName: event.target.value }))
                  }
                  placeholder="Иван"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Фамилия</label>
                <Input
                  value={profile.lastName}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, lastName: event.target.value }))
                  }
                  placeholder="Иванов"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Организация</label>
                <Input
                  value={profile.organization}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, organization: event.target.value }))
                  }
                  placeholder="AgroPulse"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Роль</label>
                <Select
                  value={profile.role}
                  onValueChange={(value) =>
                    setProfile((current) => ({ ...current, role: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите роль" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">О себе</label>
              <Textarea
                value={profile.bio}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, bio: event.target.value }))
                }
                placeholder="Коротко опишите ваш профиль и сценарии работы в Knova."
                className="min-h-28 resize-none"
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleProfileSave} disabled={updateProfile.isPending}>
                {updateProfile.isPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Сохранить профиль
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                Безопасность
              </CardTitle>
              <CardDescription>
                Смените пароль для входа в ваш аккаунт.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Текущий пароль</label>
                <Input
                  type="password"
                  value={passwords.currentPassword}
                  onChange={(event) =>
                    setPasswords((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Новый пароль</label>
                <Input
                  type="password"
                  value={passwords.newPassword}
                  onChange={(event) =>
                    setPasswords((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                />
              </div>
              <Button
                className="w-full"
                onClick={handlePasswordSave}
                disabled={
                  changePassword.isPending ||
                  !passwords.currentPassword.trim() ||
                  !passwords.newPassword.trim()
                }
              >
                {changePassword.isPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="mr-2 h-4 w-4" />
                )}
                Обновить пароль
              </Button>
            </CardContent>
          </Card>

          <Card id="ai-provider" className="border-primary/15">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                AI-провайдер
              </CardTitle>
              <CardDescription>
                Выбирайте активную модель для чатов, аналитики и генерации материалов.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted/20 p-4">
                {currentProvider.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Загружаем текущую конфигурацию...
                  </div>
                ) : currentProvider.data ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge className="gap-1 border-primary/20 bg-primary/10 text-primary">
                      <Sparkles className="h-3.5 w-3.5" />
                      {providers.data?.find((item) => item.id === currentProvider.data?.provider)
                        ?.name ?? currentProvider.data.provider}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Модель: {currentProvider.data.model}
                    </span>
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Mic className="h-4 w-4" />
                      STT {currentProvider.data.sttAvailable ? "доступен" : "недоступен"}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4">
                {providers.data?.map((provider) => {
                  const active = activeProvider === provider.id;

                  return (
                    <Card
                      key={provider.id}
                      className={active ? "border-primary/40 bg-primary/5" : ""}
                    >
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between text-lg">
                          <span>{provider.name}</span>
                          {active ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}
                        </CardTitle>
                        <CardDescription>{provider.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            STT: {provider.sttAvailable ? "есть" : "нет"}
                          </Badge>
                          <Badge variant={provider.available ? "secondary" : "outline"}>
                            {provider.available ? "Готов к работе" : "Недоступен"}
                          </Badge>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {provider.reason ?? "Провайдер готов к переключению и использованию."}
                        </p>
                        <Button
                          className="w-full"
                          variant={active ? "secondary" : "default"}
                          disabled={active || switchProvider.isPending || !provider.available}
                          onClick={() => switchProvider.mutate(provider.id)}
                        >
                          {active ? "Активен" : "Сделать основным"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/15">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-primary" />
                Приложение и PWA
              </CardTitle>
              <CardDescription>
                Установите Knova как приложение и продолжайте работу даже при нестабильной сети.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                {pwa.isInstalled
                  ? "Knova уже установлена на это устройство и может открываться как отдельное приложение."
                  : pwa.canInstall
                    ? "Установка доступна прямо сейчас. После установки приложение можно запускать из меню устройства."
                    : "Если браузер поддерживает установку, кнопка появится после первого взаимодействия со страницей в безопасном HTTPS-режиме."}
              </div>
              <Button
                className="w-full"
                variant={pwa.isInstalled ? "secondary" : "default"}
                disabled={!pwa.canInstall || pwa.isInstalled}
                onClick={() => void pwa.install()}
              >
                <Download className="mr-2 h-4 w-4" />
                {pwa.isInstalled ? "Приложение уже установлено" : "Установить Knova"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
