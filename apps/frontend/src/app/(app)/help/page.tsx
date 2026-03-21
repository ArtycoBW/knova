import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HelpPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-[Syne] text-3xl font-bold">Помощь</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Короткая памятка по первым шагам в платформе.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>1. Создайте воркспейс</CardTitle>
            <CardDescription>На главной странице нажмите «Новый воркспейс».</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Добавьте название и краткое описание, чтобы собрать материалы по одной теме в одном месте.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Загрузите источники</CardTitle>
            <CardDescription>Поддерживаются документы, аудио и видео.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            После обработки документ появится в списке источников и станет доступен для следующих режимов.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Используйте поиск</CardTitle>
            <CardDescription>Откройте глобальный поиск через Ctrl+K.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Поиск находит воркспейсы и документы и умеет сразу открыть нужный источник внутри воркспейса.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
