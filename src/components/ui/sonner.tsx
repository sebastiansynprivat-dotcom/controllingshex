import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group !z-[100]"
      style={
        {
          // Sonner liest diese CSS-Variablen für Farben — hart auf Design-Tokens gemappt.
          "--normal-bg": "hsl(var(--card))",
          "--normal-text": "hsl(var(--card-foreground))",
          "--normal-border": "hsl(var(--border))",
          "--success-bg": "hsl(var(--card))",
          "--success-text": "hsl(var(--card-foreground))",
          "--success-border": "hsl(var(--border))",
          "--error-bg": "hsl(var(--card))",
          "--error-text": "hsl(var(--destructive))",
          "--error-border": "hsl(var(--destructive) / 0.4)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast !bg-card !text-card-foreground !border-border !shadow-2xl backdrop-blur-md",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-muted !text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
