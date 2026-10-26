import { useEffect, useState } from "react";

type TextPreviewProps = {
  url: string;
};

export default function TextPreview({ url }: TextPreviewProps) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    setContent("");
    setError("");
    setLoading(true);

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not read this file.");
        }

        return response.text();
      })
      .then((text) => {
        if (active) {
          setContent(text);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("Unable to display this text file.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [url]);

  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (loading) {
    return (
      <p className="p-4 text-sm text-slate-500" role="status">
        Loading text…
      </p>
    );
  }

  if (!content) {
    return (
      <p className="p-4 text-sm text-slate-500">
        This file is empty.
      </p>
    );
  }

  return (
    <pre className="min-h-40 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-800">
      {content}
    </pre>
  );
}
