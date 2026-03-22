import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
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
