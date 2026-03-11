import { useRef, useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, List } from "lucide-react";

interface ContentEditableFieldProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ContentEditableField({
  value,
  onChange,
  disabled = false,
  placeholder,
  className,
}: ContentEditableFieldProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    unorderedList: false,
  });

  // Set innerHTML on mount and when value changes externally
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const updateActiveFormats = useCallback(() => {
    setActiveFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      unorderedList: document.queryCommandState("insertUnorderedList"),
    });
  }, []);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
    updateActiveFormats();
  }, [onChange, updateActiveFormats]);

  const handleSelectionChange = useCallback(() => {
    if (
      editorRef.current &&
      editorRef.current.contains(document.activeElement ?? null)
    ) {
      updateActiveFormats();
    }
  }, [updateActiveFormats]);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [handleSelectionChange]);

  const execCommand = useCallback(
    (command: string) => {
      if (disabled) return;
      editorRef.current?.focus();
      document.execCommand(command, false);
      handleInput();
    },
    [disabled, handleInput],
  );

  return (
    <div
      className={`rounded-md border border-input bg-background ${disabled ? "opacity-50" : ""} ${className ?? ""}`}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-input px-1 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 w-7 p-0 ${activeFormats.bold ? "bg-accent text-accent-foreground" : ""}`}
          onClick={() => execCommand("bold")}
          disabled={disabled}
          aria-label="Bold"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 w-7 p-0 ${activeFormats.italic ? "bg-accent text-accent-foreground" : ""}`}
          onClick={() => execCommand("italic")}
          disabled={disabled}
          aria-label="Italic"
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 w-7 p-0 ${activeFormats.unorderedList ? "bg-accent text-accent-foreground" : ""}`}
          onClick={() => execCommand("insertUnorderedList")}
          disabled={disabled}
          aria-label="Unordered List"
        >
          <List className="h-4 w-4" />
        </Button>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyUp={updateActiveFormats}
        onMouseUp={updateActiveFormats}
        data-placeholder={placeholder}
        className={`min-h-[100px] px-3 py-2 text-sm focus:outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] ${disabled ? "cursor-not-allowed text-muted-foreground" : ""}`}
      />
    </div>
  );
}
