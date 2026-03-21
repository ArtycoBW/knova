"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  documentId: string;
}

export function PdfViewer({ documentId }: PdfViewerProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;

    setFileUrl(null);
    setPageNumber(1);
    setNumPages(0);
    setError(null);

    api
      .get(`/documents/${documentId}/file`, { responseType: "blob" })
      .then((response) => {
        if (!active) {
          return;
        }
        currentUrl = URL.createObjectURL(response.data);
        setFileUrl(currentUrl);
      })
      .catch(() => {
        if (active) {
          setError("Не удалось загрузить PDF");
        }
      });

    return () => {
      active = false;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [documentId]);

  if (error) {
    return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>;
  }

  if (!fileUrl) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-border bg-muted/20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Загружаем PDF...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-2 text-sm">
        <span>
          Страница {pageNumber} из {numPages || 1}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageNumber((value) => Math.min(numPages, value + 1))}
            disabled={!numPages || pageNumber >= numPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-border bg-muted/10 p-4">
        <Document
          file={fileUrl}
          loading={
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              Загружаем документ...
            </div>
          }
          onLoadSuccess={({ numPages: nextPages }) => setNumPages(nextPages)}
        >
          <Page pageNumber={pageNumber} width={720} renderTextLayer={false} renderAnnotationLayer={false} />
        </Document>
      </div>
    </div>
  );
}
