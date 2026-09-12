import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import DemoNotice from "@/components/layout/DemoNotice";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Sidebar />
      <TopBar />
      <main className="lg:ml-64 pt-14 min-h-screen">
        <DemoNotice />
        <div className="max-w-[1400px] mx-auto p-4 sm:p-unit-6 lg:p-unit-8 pb-unit-16">
          {children}
        </div>
      </main>
    </>
  );
}
