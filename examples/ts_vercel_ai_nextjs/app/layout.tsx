import "./globals.css";
export const metadata = {
  title: "HumanLayer + Vercel AI SDK + Next.js",
  description: "Chat example with human oversight",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="bg-[#426699] text-white p-4 text-center">
          <h1 className="text-2xl font-bold">
            HumanLayer + Vercel AI SDK + Next.js
          </h1>
        </header>
        {children}
      </body>
    </html>
  );
}
