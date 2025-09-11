import * as React from "react"
import { Link, Share } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

const copyLinkButtonVariants = cva("", {
  variants: {
    variant: {
      icon: "",
      button: "",
      text: "text-sm text-muted-foreground hover:text-foreground",
    },
  },
  defaultVariants: {
    variant: "icon",
  },
})

export interface CopyLinkButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">,
    VariantProps<typeof copyLinkButtonVariants> {
  /** Custom path to copy (default: current path) */
  path?: string
  /** Include current query params (default: true) */
  preserveQuery?: boolean
  /** Include current hash (default: true) */
  preserveHash?: boolean
  /** Display style variant */
  variant?: "icon" | "button" | "text"
  /** Custom success message for toast */
  successMessage?: string
  /** Use Share icon instead of Link icon */
  useShareIcon?: boolean
  /** Additional CSS classes */
  className?: string
  /** Test identifier */
  "data-testid"?: string
}

const CopyLinkButton = React.forwardRef<HTMLButtonElement, CopyLinkButtonProps>(
  (
    {
      path,
      preserveQuery = true,
      preserveHash = true,
      variant = "icon",
      successMessage = "Link copied to clipboard!",
      useShareIcon = false,
      className,
      "data-testid": dataTestId,
      ...props
    },
    ref
  ) => {
    const { toast } = useToast()
    const IconComponent = useShareIcon ? Share : Link

    const constructUrl = React.useCallback(() => {
      const currentUrl = new URL(window.location.href)
      const baseUrl = window.location.origin

      // Use custom path or current pathname
      const targetPath = path || currentUrl.pathname

      // Build the URL parts
      let url = baseUrl + targetPath

      // Add query parameters if preserveQuery is true
      if (preserveQuery && currentUrl.search) {
        url += currentUrl.search
      }

      // Add hash if preserveHash is true
      if (preserveHash && currentUrl.hash) {
        url += currentUrl.hash
      }

      return url
    }, [path, preserveQuery, preserveHash])

    const handleCopyLink = React.useCallback(async () => {
      try {
        const urlToCopy = constructUrl()
        
        // Check if clipboard API is available
        if (!navigator.clipboard) {
          // Fallback for older browsers
          const textArea = document.createElement("textarea")
          textArea.value = urlToCopy
          textArea.style.position = "fixed"
          textArea.style.left = "-999999px"
          textArea.style.top = "-999999px"
          document.body.appendChild(textArea)
          textArea.focus()
          textArea.select()
          document.execCommand("copy")
          document.body.removeChild(textArea)
        } else {
          await navigator.clipboard.writeText(urlToCopy)
        }

        toast({
          title: "Success",
          description: successMessage,
        })
      } catch (error) {
        console.error("Failed to copy link:", error)
        toast({
          title: "Error",
          description: "Failed to copy link. Please try again.",
          variant: "destructive",
        })
      }
    }, [constructUrl, successMessage, toast])

    // Render different variants
    if (variant === "text") {
      return (
        <button
          ref={ref}
          onClick={handleCopyLink}
          className={cn(
            "inline-flex items-center gap-1.5 transition-colors cursor-pointer",
            copyLinkButtonVariants({ variant }),
            className
          )}
          data-testid={dataTestId || "button-copy-link"}
          {...props}
        >
          <IconComponent className="h-3.5 w-3.5" />
          Copy Link
        </button>
      )
    }

    if (variant === "button") {
      return (
        <Button
          ref={ref}
          onClick={handleCopyLink}
          variant="outline"
          className={cn("gap-2", className)}
          data-testid={dataTestId || "button-copy-link"}
          {...props}
        >
          <IconComponent className="h-4 w-4" />
          Copy Link
        </Button>
      )
    }

    // Default icon variant
    return (
      <Button
        ref={ref}
        onClick={handleCopyLink}
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8", className)}
        data-testid={dataTestId || "button-copy-link"}
        {...props}
      >
        <IconComponent className="h-4 w-4" />
        <span className="sr-only">Copy link</span>
      </Button>
    )
  }
)

CopyLinkButton.displayName = "CopyLinkButton"

export { CopyLinkButton, copyLinkButtonVariants }