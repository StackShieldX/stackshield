import { useParams, useNavigate } from "react-router-dom";

/** Placeholder page for viewing a single scan result. */
export default function ScanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div className="p-6">
      <button
        onClick={() => navigate("/history")}
        className="mb-4 flex items-center gap-1 text-sm text-surface-400 transition-colors hover:text-surface-200"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path
            fillRule="evenodd"
            d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
            clipRule="evenodd"
          />
        </svg>
        Back to history
      </button>
      <h1 className="text-2xl font-semibold text-surface-100">Scan Results</h1>
      <p className="mt-2 text-sm text-surface-400">
        Viewing scan{" "}
        <code className="rounded bg-surface-800 px-1.5 py-0.5 font-mono text-xs text-surface-300">
          {id}
        </code>
      </p>
    </div>
  );
}
