import { serializeJsonLd, type JsonLdObject } from "@/lib/jsonld";

/** Renders one or more JSON-LD objects. Each object gets its own <script> tag. */
export default function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const list = Array.isArray(data) ? data : [data];
  return (
    <>
      {list.map((item, index) => (
        <script
          key={index}
          type="application/ld+json"
          // JSON-LD is data, not executable script; serializeJsonLd escapes "<" so it cannot close the tag.
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }}
        />
      ))}
    </>
  );
}
