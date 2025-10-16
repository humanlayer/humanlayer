import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { Extensions } from "@tiptap/react";
import { ElectricProvider } from "../y-electric";

// Colors that have good contrast with black text (WCAG AA compliant)
const accessibleColors = [
  '#FFE5B4', // Peach
  '#E6F3FF', // Light Blue
  '#E8FFE8', // Mint Green
  '#FFF0F5', // Lavender
  '#FFFACD', // Lemon Chiffon
  '#F0FFF0', // Honeydew
  '#F5F5DC', // Beige
  '#F0F8FF', // Alice Blue
];

interface UserInfo {
  name: string;
  color: string;
}

function getOrCreateUserInfo(): UserInfo {
  const storedInfo = localStorage.getItem('humanlayer-user');
  if (storedInfo) {
    return JSON.parse(storedInfo);
  }

  const newInfo = {
    name: `User ${Math.floor(Math.random() * 100)}`,
    color: accessibleColors[Math.floor(Math.random() * accessibleColors.length)]
  };

  localStorage.setItem('humanlayer-user', JSON.stringify(newInfo));
  return newInfo;
}

export function createTiptapExtensions(provider: ElectricProvider): Extensions {
  const userInfo = getOrCreateUserInfo();

  return [
    StarterKit.configure({
      history: false, // Important: Disable history as we're using collaboration
    }),
    Collaboration.extend().configure({
      document: provider.doc,
    }),
    CollaborationCursor.extend().configure({
      provider,
      user: {
        name: userInfo.name,
        color: userInfo.color,
      },
    }),
  ];
}
