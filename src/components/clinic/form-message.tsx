import { Notice } from "@/components/ui/notice";

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Notice tone="danger" role="alert">
      {message}
    </Notice>
  );
}

export function FormSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Notice tone="success" role="status">
      {message}
    </Notice>
  );
}
