"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  ArrowDownToLine,
  ArrowLeft,
  AudioLines,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  Table2,
  Video,
  WandSparkles,
} from "lucide-react";
import { useParams } from "next/navigation";
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useGenerateTable, useTable } from "@/hooks/use-table";

type TableRow = {
  id: string;
  values: Record<string, string>;
};

function getStatusBadge(
  status?: "PENDING" | "GENERATING" | "READY" | "ERROR" | null,
) {
  switch (status) {
    case "READY":
      return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300";
    case "GENERATING":
      return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300";
    case "ERROR":
      return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-300";
    default:
      return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300";
  }
}

function getStatusLabel(
  status?: "PENDING" | "GENERATING" | "READY" | "ERROR" | null,
) {
  switch (status) {
    case "READY":
      return "Готово";
    case "GENERATING":
      return "Собираем таблицу";
    case "ERROR":
      return "Ошибка";
    default:
      return "В очереди";
  }
}

function getSourceIcon(sourceType: "FILE" | "AUDIO" | "VIDEO") {
  if (sourceType === "AUDIO") {
    return <AudioLines className="h-3.5 w-3.5" />;
  }

  if (sourceType === "VIDEO") {
    return <Video className="h-3.5 w-3.5" />;
  }

  return <FileText className="h-3.5 w-3.5" />;
}

function buildCsv(title: string, headers: string[], rows: Array<Array<string | number>>) {
  const escapeCell = (value: string | number) => {
    const text = String(value ?? "");
    if (/[",;\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  return [
    title,
    "",
    headers.map(escapeCell).join(";"),
    ...rows.map((row) => row.map(escapeCell).join(";")),
  ].join("\r\n");
}

export default function TableWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useTable(id);
  const generateTable = useGenerateTable(id);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);

  const canGenerate = (data?.readyDocuments.length ?? 0) > 0;
  const isBusy =
    data?.table?.status === "PENDING" || data?.table?.status === "GENERATING";
  const headers = data?.table?.tableData.headers ?? [];
  const rawRows = data?.table?.tableData.rows ?? [];
  const hasTable = headers.length > 0 && rawRows.length > 0;

  const rows = useMemo<TableRow[]>(
    () =>
      rawRows.map((row, index) => ({
        id: `row-${index + 1}`,
        values: headers.reduce<Record<string, string>>((acc, header, headerIndex) => {
          acc[header] = String(row[headerIndex] ?? "");
          return acc;
        }, {}),
      })),
    [headers, rawRows],
  );

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () =>
      headers.map((header) => ({
        accessorFn: (row) => row.values[header] ?? "",
        id: header,
        header: () => header,
        cell: ({ row }) => (
          <div className="max-w-[260px] whitespace-normal break-words text-sm leading-6">
            {row.original.values[header] || "—"}
          </div>
        ),
      })),
    [headers],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      globalFilter,
      sorting,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _, filterValue) =>
      Object.values(row.original.values).some((value) =>
        value.toLowerCase().includes(String(filterValue).toLowerCase()),
      ),
  });

  const handleGenerate = async () => {
    await generateTable.mutateAsync();
  };

  const handleDownloadCsv = () => {
    if (!data?.table || !hasTable) {
      return;
    }

    const blob = new Blob(
      [
        "\ufeff",
        buildCsv(
          data.table.title,
          data.table.tableData.headers,
          data.table.tableData.rows,
        ),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(data.table.title || `table-${id}`).replace(/[\\/:*?"<>|]+/g, "-")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-full rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-muted-foreground">Таблица недоступна</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <a
            href={`/workspace/${id}`}
            className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Вернуться к воркспейсу
          </a>
          <h1 className="text-3xl font-semibold">Таблица данных</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Воркспейс: {data.workspace.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`gap-2 ${getStatusBadge(data.table?.status)}`}>
            <Table2 className="h-3.5 w-3.5" />
            {getStatusLabel(data.table?.status)}
          </Badge>
          <Badge className="gap-2 border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/20">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            TanStack Table
          </Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="flex min-h-0 flex-col border-border/80">
          <CardHeader>
            <CardTitle>Панель данных</CardTitle>
            <CardDescription>
              AI извлекает табличные данные из готовых материалов и сводит их в единую структуру.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-2">
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-medium">Готовые источники</p>
              <div className="mt-3 space-y-2">
                {data.readyDocuments.length ? (
                  data.readyDocuments.map((document) => (
                    <div
                      key={document.id}
                      className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-sm"
                    >
                      {getSourceIcon(document.sourceType)}
                      <span className="truncate">{document.originalName}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Пока нет готовых материалов для извлечения таблицы.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Колонки</p>
                <p className="mt-2 text-2xl font-semibold">{headers.length}</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Строки</p>
                <p className="mt-2 text-2xl font-semibold">{rawRows.length}</p>
              </div>
            </div>

            <Button
              className="h-11 w-full"
              onClick={handleGenerate}
              disabled={!canGenerate || generateTable.isPending || isBusy}
            >
              {generateTable.isPending || isBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <WandSparkles className="mr-2 h-4 w-4" />
              )}
              {hasTable ? "Пересобрать таблицу" : "Собрать таблицу"}
            </Button>

            {!canGenerate ? (
              <Button asChild variant="outline" className="w-full">
                <a href={`/workspace/${id}`}>Перейти к загрузке</a>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden border-border/80">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{data.table?.title || `Таблица: ${data.workspace.name}`}</CardTitle>
                <CardDescription className="mt-2">
                  {hasTable
                    ? `Извлечено из ${data.table?.tableData.generatedFrom || data.readyDocuments.length} готовых источников`
                    : "Соберите таблицу по готовым документам, аудио и видео этого воркспейса."}
                </CardDescription>
              </div>

              {hasTable ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleDownloadCsv}>
                    <ArrowDownToLine className="mr-2 h-4 w-4" />
                    CSV
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-5 p-6">
            {!canGenerate ? (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="max-w-md space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-border bg-muted/40">
                    <Table2 className="h-7 w-7 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">Пока нет материалов</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Добавьте документы, аудио или видео в воркспейс, чтобы собрать таблицу.
                    </p>
                  </div>
                  <Button asChild>
                    <a href={`/workspace/${id}`}>Перейти к загрузке</a>
                  </Button>
                </div>
              </div>
            ) : !hasTable && !isBusy ? (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="max-w-lg space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
                    <Table2 className="h-7 w-7" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">Соберите первую таблицу</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      AI извлечёт числовые и структурированные данные из ваших материалов и сведёт их в удобный вид для сортировки и экспорта.
                    </p>
                  </div>
                  <Button onClick={handleGenerate} disabled={generateTable.isPending}>
                    {generateTable.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <WandSparkles className="mr-2 h-4 w-4" />
                    )}
                    Запустить генерацию
                  </Button>
                </div>
              </div>
            ) : hasTable ? (
              <div className="flex min-h-0 flex-1 flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{headers.length} колонок</Badge>
                  <Badge variant="outline">{rawRows.length} строк</Badge>
                  <Badge variant="outline">
                    Обновлено{" "}
                    {data.table?.updatedAt
                      ? formatDistanceToNow(new Date(data.table.updatedAt), {
                          locale: ru,
                          addSuffix: true,
                        })
                      : "только что"}
                  </Badge>
                </div>

                {data.table?.tableData.summary ? (
                  <div className="rounded-2xl border border-border bg-muted/10 px-4 py-3 text-sm leading-6 text-muted-foreground">
                    {data.table.tableData.summary}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-[260px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={globalFilter}
                      onChange={(event) => setGlobalFilter(event.target.value)}
                      placeholder="Поиск по таблице"
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-muted/10">
                  <div className="h-full overflow-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                        {table.getHeaderGroups().map((headerGroup) => (
                          <tr key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                              <th
                                key={header.id}
                                className="border-b border-border px-4 py-3 font-medium text-foreground"
                              >
                                {header.isPlaceholder ? null : (
                                  <button
                                    type="button"
                                    onClick={header.column.getToggleSortingHandler()}
                                    className="inline-flex items-center gap-2"
                                  >
                                    {flexRender(
                                      header.column.columnDef.header,
                                      header.getContext(),
                                    )}
                                    {{
                                      asc: <ChevronUp className="h-4 w-4 text-muted-foreground" />,
                                      desc: <ChevronDown className="h-4 w-4 text-muted-foreground" />,
                                    }[header.column.getIsSorted() as string] ?? null}
                                  </button>
                                )}
                              </th>
                            ))}
                          </tr>
                        ))}
                      </thead>
                      <tbody>
                        {table.getRowModel().rows.length ? (
                          table.getRowModel().rows.map((row) => (
                            <tr key={row.id} className="odd:bg-background even:bg-muted/5">
                              {row.getVisibleCells().map((cell) => (
                                <td
                                  key={cell.id}
                                  className="border-b border-border/60 px-4 py-3 align-top"
                                >
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                              ))}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={Math.max(headers.length, 1)}
                              className="px-4 py-10 text-center text-sm text-muted-foreground"
                            >
                              По текущему фильтру ничего не найдено.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {isBusy ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 dark:text-amber-300">
                    Собираем новую версию таблицы. Текущие данные остаются на экране, пока не придёт обновлённый результат.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="rounded-2xl border border-border bg-background/95 px-5 py-4 shadow-lg">
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Собираем таблицу...
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
