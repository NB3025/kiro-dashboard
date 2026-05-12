import Link from 'next/link';

export default function InsightsPage() {
  return (
    <div className="p-8 text-gray-300">
      <h1 className="text-2xl font-semibold text-white mb-4">Insights</h1>
      <p className="mb-6">
        사용자별 Kiro 사용 인사이트는 사용자 목록에서 개별 사용자를 선택하면 볼 수
        있습니다.
      </p>
      <Link
        href="/users"
        className="inline-block px-4 py-2 rounded-md bg-[#9046FF] text-white hover:bg-[#7a3adf]"
      >
        사용자 목록으로 이동
      </Link>
    </div>
  );
}
