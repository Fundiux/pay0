"use client";

export default function NoAccess({
  message,
  as = "div",
  className = "",
}: {
  message: string;
  as?: "div" | "main";
  className?: string;
}) {
  const content = (
    <div className="w-[90%] mx-auto py-10 text-slate-400">
      {message}
    </div>
  );

  if (as === "main") {
    return <main className={className || "p-6 text-slate-400"}>{message}</main>;
  }

  return <div className={className || "w-[90%] mx-auto py-10 text-slate-400"}>{message}</div>;
}
