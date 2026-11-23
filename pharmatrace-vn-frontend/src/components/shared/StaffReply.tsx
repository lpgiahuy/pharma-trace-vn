import { formatDateTime } from '@/utils';

interface StaffReplyProps {
  name?: string | null;
  date: string;
  text: string;
  connector?: boolean;
}

export function StaffReply({ name, date, text, connector = true }: StaffReplyProps) {
  return (
    <div className="relative mt-4 pl-12 sm:pl-14">
      {connector && (
        <div
          className="absolute left-5 top-[-14px] w-7 h-10 border-l border-b border-slate-300 rounded-bl-xl pointer-events-none"
          aria-hidden="true"
        />
      )}

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[#004996] text-white flex flex-col items-center justify-center shrink-0 p-1 text-center shadow-xs">
          <span className="text-[7px] font-bold uppercase tracking-tighter leading-tight opacity-90">PHARMACY</span>
          <span className="text-[9px] font-black leading-tight">PharmaTrace</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-slate-900">{name || 'PharmaTrace'}</span>
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#0090FF] text-white shrink-0"
              title="Verified Pharmacy Partner"
            >
              <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{formatDateTime(date)}</div>
        </div>
      </div>

      <div className="pl-13 mt-2 text-sm text-slate-800 leading-relaxed whitespace-pre-line font-normal">{text}</div>
    </div>
  );
}
