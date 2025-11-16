export const metadata = {
  title: "Agentic Chat",
  description: "AI chat with web browsing and PDF analysis"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, Arial, sans-serif', background: '#0b1220', color: '#e6e6e6' }}>
        {children}
      </body>
    </html>
  );
}
