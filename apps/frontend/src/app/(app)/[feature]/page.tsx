import { notFound } from "next/navigation";
import { FeaturePlaceholder } from "@/components/app/feature-placeholder";

const FEATURES: Record<string, { title: string; description: string; hint: string }> = {
  chat: {
    title: "Чат с источниками",
    description: "Здесь появится диалоговый режим по документам воркспейса.",
    hint: "Полный RAG-чат и потоковая выдача запланированы на следующий этап.",
  },
  mindmap: {
    title: "Карта знаний",
    description: "Раздел для генерации и просмотра интеллект-карт.",
    hint: "Генерация узлов и визуализация reactflow будут добавлены следующим этапом.",
  },
  podcast: {
    title: "Подкасты",
    description: "Раздел для сборки AI-подкаста по материалам воркспейса.",
    hint: "Скрипт диалога и аудиогенерация будут добавлены в следующем этапе.",
  },
  quiz: {
    title: "Тесты",
    description: "Раздел для генерации вопросов и проверки знаний.",
    hint: "Интерактивные карточки и режим тестирования будут добавлены следующим этапом.",
  },
  reports: {
    title: "Отчёты",
    description: "Раздел для автоматической подготовки деловых резюме.",
    hint: "Генерация отчётов и экспорт появятся на следующих этапах.",
  },
  infographic: {
    title: "Инфографика",
    description: "Раздел для построения графиков и визуальных выводов.",
    hint: "Извлечение данных и рендер графиков добавим следующим этапом.",
  },
  table: {
    title: "Таблицы",
    description: "Раздел для извлечения структурированных данных из источников.",
    hint: "Распознавание таблиц и экспорт CSV добавим следующим этапом.",
  },
  presentation: {
    title: "Презентации",
    description: "Раздел для генерации структуры и слайдов презентации.",
    hint: "Автогенерация слайдов будет реализована следующим этапом.",
  },
};

export default async function FeatureIndexPage({
  params,
}: {
  params: Promise<{ feature: string }>;
}) {
  const { feature } = await params;
  const config = FEATURES[feature];

  if (!config) {
    notFound();
  }

  return <FeaturePlaceholder {...config} />;
}
