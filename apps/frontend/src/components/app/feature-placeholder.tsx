import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface FeaturePlaceholderProps {
  title: string;
  description: string;
  hint: string;
  workspaceId?: string;
}

export function FeaturePlaceholder({
  title,
  description,
  hint,
  workspaceId,
}: FeaturePlaceholderProps) {
  const backHref = workspaceId ? `/workspace/${workspaceId}` : "/dashboard";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[Syne] text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Назад
          </Link>
        </Button>
      </div>

      <Card className="border-primary/20 bg-linear-to-br from-card to-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Раздел готов к следующему этапу
          </CardTitle>
          <CardDescription>{hint}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Основа shell уже на месте: воркспейс, документы, поиск и уведомления
            работают. Следующим сообщением можно переходить к полноценной
            генерации этого режима.
          </p>
          <p>
            Если хотите, я продолжу с реализацией именно этого раздела без
            возврата к инфраструктуре.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
