"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Contact } from "@/lib/api";
import { X } from "lucide-react";

interface Props {
  selected: Contact[];
  onChange: (contacts: Contact[]) => void;
  placeholder?: string;
  className?: string;
}

export function ContactsPicker({ selected, onChange, placeholder = "Who were you with?", className = "" }: Props) {
  const [input, setInput] = useState("");
  const qc = useQueryClient();

  const { data: allContacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.contacts(),
    staleTime: 5 * 60 * 1000,
  });

  const add = (contact: Contact) => {
    if (!selected.find((p) => p.id === contact.id)) {
      onChange([...selected, contact]);
    }
    setInput("");
  };

  const remove = (id: number) => {
    onChange(selected.filter((p) => p.id !== id));
  };

  const q = input.trim().toLowerCase();
  const activeIds = new Set(selected.map((p) => p.id));
  const suggestions = q.length > 0
    ? allContacts.filter((c) => c.name.toLowerCase().includes(q) && !activeIds.has(c.id))
    : [];
  const showCreate = q.length > 0 && !allContacts.find((c) => c.name.toLowerCase() === q);

  return (
    <div className={`relative ${className}`}>
      <div className="flex flex-wrap gap-1.5 items-center min-h-[38px] bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 focus-within:border-[#F59E0B] transition-colors">
        {selected.map((contact) => (
          <span key={contact.id} className="flex items-center gap-1 bg-[#27272A] text-[#D4D4D8] text-xs px-2 py-1 rounded-full">
            {contact.emoji && <span>{contact.emoji}</span>}
            {contact.name}
            <button
              type="button"
              onClick={() => remove(contact.id)}
              className="text-[#52525B] hover:text-[#FAFAFA] ml-0.5"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={async (e) => {
            if ((e.key === "Enter" || e.key === ",") && input.trim()) {
              e.preventDefault();
              const name = input.trim().replace(/,$/, "");
              let contact = allContacts.find((c) => c.name.toLowerCase() === name.toLowerCase());
              if (!contact) {
                try {
                  contact = await api.createContact({ name });
                  qc.invalidateQueries({ queryKey: ["contacts"] });
                } catch { return; }
              }
              add(contact);
            } else if (e.key === "Escape") {
              setInput("");
            } else if (e.key === "Backspace" && !input && selected.length > 0) {
              remove(selected[selected.length - 1].id);
            }
          }}
          placeholder={selected.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] bg-transparent text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none"
        />
      </div>

      {(suggestions.length > 0 || showCreate) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-[#18181B] border border-[#27272A] rounded-lg overflow-hidden shadow-lg">
          {suggestions.slice(0, 5).map((contact) => (
            <button
              key={contact.id}
              type="button"
              onMouseDown={async (e) => {
                e.preventDefault();
                add(contact);
              }}
              className="w-full text-left px-4 py-2 text-sm text-[#D4D4D8] hover:bg-[#27272A] transition-colors"
            >
              {contact.emoji && <span className="mr-1">{contact.emoji}</span>}
              {contact.name}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseDown={async (e) => {
                e.preventDefault();
                const name = input.trim();
                try {
                  const contact = await api.createContact({ name });
                  qc.invalidateQueries({ queryKey: ["contacts"] });
                  add(contact);
                } catch { /* ignore */ }
              }}
              className="w-full text-left px-4 py-2 text-sm text-[#F59E0B] hover:bg-[#27272A] transition-colors"
            >
              + Add &ldquo;{input.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
