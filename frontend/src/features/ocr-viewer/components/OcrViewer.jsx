import React from "react";

const DEFAULT_PAGE_RATIO = "8.27 / 11.69";

const unwrapOcrPayload = (value) => {
  if (!value) return null;
  if (value.structuredJson) return unwrapOcrPayload(value.structuredJson);
  if (value.structured_json) return unwrapOcrPayload(value.structured_json);
  if (value.rawResponse) return unwrapOcrPayload(value.rawResponse);
  if (value.raw_response) return unwrapOcrPayload(value.raw_response);
  return value;
};

const getPages = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload.pages)) return payload.pages;
  if (Array.isArray(payload.document?.pages)) return payload.document.pages;
  return [];
};

const getPageText = (page) => {
  if (!page) return "";
  if (typeof page.text === "string" && page.text.trim()) return page.text.trim();
  const groups = [page.lines, page.paragraphs, page.blocks].filter(Array.isArray);
  for (const group of groups) {
    const text = group.map((item) => item?.text || item?.content || "").filter(Boolean).join("\n").trim();
    if (text) return text;
  }
  return "";
};

const getPayloadText = (payload, fallback = "") => {
  if (payload?.text && typeof payload.text === "string") return payload.text;
  const pages = getPages(payload);
  const text = pages.map(getPageText).filter(Boolean).join("\n\n").trim();
  return text || fallback || "";
};

const getLayoutItems = (page) => {
  const groups = [page?.lines, page?.paragraphs, page?.blocks].filter(Array.isArray);
  const withBoxes = groups.find((group) => group.some((item) => item?.boundingBox || item?.bounding_box || item?.bbox));
  if (withBoxes) return withBoxes;
  return groups.find((group) => group.length > 0) || [];
};

const normalizeBox = (item) => {
  const box = item?.boundingBox || item?.bounding_box || item?.bbox || item?.layout?.boundingBox;
  if (!box || typeof box !== "object") return null;
  const left = Number(box.left ?? box.x ?? 0);
  const top = Number(box.top ?? box.y ?? 0);
  const width = Number(box.width ?? box.w ?? 0);
  const height = Number(box.height ?? box.h ?? 0);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  return {
    left: Math.max(0, Math.min(1, left)),
    top: Math.max(0, Math.min(1, top)),
    width: Math.max(0.01, Math.min(1, width)),
    height: Math.max(0.008, Math.min(1, height)),
  };
};

const pageRatio = (page) => {
  const dimension = page?.dimension || page?.dimensions || {};
  const width = Number(dimension.width);
  const height = Number(dimension.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `${width} / ${height}`;
  }
  return DEFAULT_PAGE_RATIO;
};

const renderOriginal = ({ fileType, fileUrl, textContent, filename, onError }) => {
  if (fileType === "text" && textContent) {
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 text-sm leading-relaxed text-gray-800 font-mono">
        {textContent}
      </pre>
    );
  }

  if (fileType === "image" && fileUrl) {
    return (
      <div className="h-full overflow-auto p-4 flex items-start justify-center bg-gray-50">
        <img
          src={fileUrl}
          alt={filename}
          className="max-w-full rounded-md shadow-sm"
          onError={() => onError?.("Failed to load image")}
        />
      </div>
    );
  }

  if (fileType === "pdf" && fileUrl) {
    return (
      <iframe
        src={fileUrl}
        title={filename}
        className="w-full h-full border-0 bg-white"
        onError={() => onError?.("Failed to load PDF")}
      />
    );
  }

  if (fileUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center text-gray-600">
        <p>Preview not available for this file type.</p>
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center bg-[#21C1B6] hover:bg-[#1AA49B] text-white px-4 py-2 rounded-md transition-colors"
        >
          Open in new tab
        </a>
      </div>
    );
  }

  return <div className="h-full flex items-center justify-center p-6 text-gray-500">No original preview available.</div>;
};

const renderFlowingPage = (page, index) => {
  const text = getPageText(page);
  return (
    <div key={page?.pageNumber || index} className="mx-auto w-full max-w-[820px] bg-white border border-gray-200 shadow-sm mb-4 p-6">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Page {page?.pageNumber || index + 1}
      </div>
      <pre className="whitespace-pre-wrap break-words font-serif text-[13px] leading-6 text-gray-950">
        {text || "No OCR text found on this page."}
      </pre>
    </div>
  );
};

const renderPositionedPage = (page, index) => {
  const items = getLayoutItems(page);
  const positioned = items
    .map((item, itemIndex) => ({ item, box: normalizeBox(item), itemIndex }))
    .filter(({ box, item }) => box && (item?.text || item?.content));

  if (!positioned.length) return renderFlowingPage(page, index);

  return (
    <div key={page?.pageNumber || index} className="mx-auto w-full max-w-[820px] mb-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Page {page?.pageNumber || index + 1}
      </div>
      <div
        className="relative w-full bg-white border border-gray-200 shadow-sm overflow-hidden"
        style={{ aspectRatio: pageRatio(page) }}
      >
        {positioned.map(({ item, box, itemIndex }) => {
          const text = item.text || item.content || "";
          return (
            <div
              key={`${page?.pageNumber || index}-${itemIndex}`}
              className="absolute overflow-hidden whitespace-pre-wrap break-words text-[7px] sm:text-[8px] md:text-[9px] leading-tight text-gray-950"
              style={{
                left: `${box.left * 100}%`,
                top: `${box.top * 100}%`,
                width: `${box.width * 100}%`,
                minHeight: `${box.height * 100}%`,
                fontFamily: '"Times New Roman", Georgia, serif',
              }}
            >
              {text}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const renderOcr = ({ ocrStructure, ocrText }) => {
  const payload = unwrapOcrPayload(ocrStructure);
  const pages = getPages(payload);

  if (pages.length) {
    return <div className="p-4">{pages.map(renderPositionedPage)}</div>;
  }

  const text = getPayloadText(payload, ocrText);
  if (text) {
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 text-sm leading-relaxed text-gray-900 font-serif bg-white">
        {text}
      </pre>
    );
  }

  return <div className="h-full flex items-center justify-center p-6 text-gray-500">No OCR reconstruction available.</div>;
};

const Panel = ({ title, children }) => (
  <section className="min-h-0 rounded-lg border border-gray-200 bg-white overflow-hidden flex flex-col">
    <div className="flex-shrink-0 px-4 py-2.5 border-b border-gray-100 bg-gray-50">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
    </div>
    <div className="flex-1 min-h-0 overflow-auto bg-gray-100">{children}</div>
  </section>
);

const OcrViewer = ({
  fileType,
  fileUrl,
  textContent,
  ocrStructure,
  ocrText,
  filename = "Document",
  className = "h-[75vh]",
  onError,
}) => {
  const payload = unwrapOcrPayload(ocrStructure);
  const rightText = getPayloadText(payload, ocrText || "");
  const hasOcrContent = Boolean(payload || rightText);

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 ${className}`}>
      <Panel title="Original file">
        {renderOriginal({ fileType, fileUrl, textContent, filename, onError })}
      </Panel>
      <Panel title="OCR reconstruction">
        {renderOcr({ ocrStructure: payload, ocrText: rightText })}
      </Panel>
    </div>
  );
};

export default OcrViewer;
