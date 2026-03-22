import { Toaster as SonnerToaster } from "sonner";

export function Toaster({ theme = "light" }: { theme?: "light" | "dark" | "system" }) {
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-center"
      closeButton={false}
      richColors={false}
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast: "remotelab-sonner-toast",
          title: "remotelab-sonner-title",
          description: "remotelab-sonner-description",
          success: "remotelab-sonner-success",
          error: "remotelab-sonner-error",
        },
      }}
    />
  );
}
