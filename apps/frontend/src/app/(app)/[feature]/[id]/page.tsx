import { notFound } from "next/navigation";
import { FeaturePlaceholder } from "@/components/app/feature-placeholder";

const FEATURES: Record<string, { title: string; description: string; hint: string }> = {
  chat: {
    title: "Чат с источниками",
    description: "Этот экран подготовлен под диалог по материалам выбранного воркспейса.",
    hint: "Полный RAG-чат и потоковая выдача будут реализованы следующим этапом.",
  },
  mindmap: {
    title: "Карта знаний",
    description: "Здесь появится интеллект-карта по документам текущего воркспейса.",
    hint: "Генерация структуры и визуализация reactflow будут добавлены следующим этапом.",
  },
  podcast: {
    title: "Подкаст",
    description: "Экран подготовлен для генерации сценария подкаста по выбранным источникам.",
    hint: "Диалог ведущих и экспорт сценария будут реализованы следующим этапом.",
  },
  quiz: {
    title: "Тест",
    description: "Здесь появятся вопросы и карточки по материалам воркспейса.",
    hint: "Генерация тестов и режим прохождения будут добавлены следующим этапом.",
  },
  reports: {
    title: "Отчёт",
    description: "Экран подготовлен под автоматическое деловое резюме по документам.",
    hint: "Генерация текста отчёта и экспорт будут реализованы следующим этапом.",
  },
  infographic: {
    title: "Инфографика",
    description: "Здесь будут собираться графики и визуальные выводы по данным.",
    hint: "Подбор типа графика и рендер данных будут добавлены следующим этапом.",
  },
  table: {
    title: "Таблица",
    description: "Экран подготовлен для извлечения табличных данных из источников.",
    hint: "Извлечение структуры и экспорт CSV появятся следующим этапом.",
  },
  presentation: {
    title: "Презентация",
    description: "Здесь появится генерация структуры и содержимого слайдов.",
    hint: "Подготовка презентаций и экспорт будут реализованы следующим этапом.",
  },
};

export default async function FeatureWorkspacePage({
  params,
}: {
  params: Promise<{ feature: string; id: string }>;
}) {
  const { feature, id } = await params;
  const config = FEATURES[feature];

  if (!config) {
    notFound();
  }

  return <FeaturePlaceholder {...config} workspaceId={id} />;
}
