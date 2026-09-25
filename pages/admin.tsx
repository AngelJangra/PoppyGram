// ---------------------------------------------------------------------------
// /admin redirect page.
//
// The admin dashboard and login screen live at the site root (pages/index.tsx).
// The deployment guide and test plan in prompttest.txt reference /admin, so
// this page exists to keep those URLs valid. It performs a server-side redirect
// to "/" — no duplicate login UI needed.
//
// No changes to middleware.ts are required: unauthenticated page requests
// already fall through to NextResponse.next(), and the client-side auth check
// in pages/index.tsx handles the login flow.
// ---------------------------------------------------------------------------
import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "/", permanent: false },
});

export default function AdminRedirect() {
  return null;
}
