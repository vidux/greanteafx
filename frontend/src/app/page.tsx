import { ConsoleMount } from '@/components/ConsoleMount';

/**
 * This page stays a Server Component so the document shell still streams from the server; the
 * console itself is mounted client-only by `ConsoleMount` — see the note there for why.
 */
export default function Home() {
  return <ConsoleMount />;
}
