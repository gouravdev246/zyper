import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export interface LocalMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface LocalConversation {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory fallback cache when PostgreSQL is not yet reachable in dev
const memoryConversations = new Map<string, LocalConversation>();
const memoryMessages = new Map<string, LocalMessage[]>();

export class ConversationService {
  private defaultUserId = '00000000-0000-0000-0000-000000000001';

  async listConversations(): Promise<LocalConversation[]> {
    try {
      const records = await prisma.conversation.findMany({
        orderBy: { updatedAt: 'desc' },
      });
      return records.map((r) => ({
        id: r.id,
        userId: r.userId,
        title: r.title,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    } catch {
      logger.debug('Database unavailable, serving conversations from memory cache');
      return Array.from(memoryConversations.values()).sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
      );
    }
  }

  async createConversation(title?: string): Promise<LocalConversation> {
    const convoTitle = title?.trim() || 'New Conversation';
    try {
      // Ensure default user exists
      await prisma.user.upsert({
        where: { id: this.defaultUserId },
        update: {},
        create: {
          id: this.defaultUserId,
          email: 'user@zyper.local',
          name: 'Primary Operator',
        },
      });

      const convo = await prisma.conversation.create({
        data: {
          userId: this.defaultUserId,
          title: convoTitle,
        },
      });

      return convo;
    } catch {
      const newConvo: LocalConversation = {
        id: crypto.randomUUID(),
        userId: this.defaultUserId,
        title: convoTitle,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryConversations.set(newConvo.id, newConvo);
      memoryMessages.set(newConvo.id, []);
      return newConvo;
    }
  }

  async getConversation(id: string): Promise<LocalConversation | null> {
    try {
      const convo = await prisma.conversation.findUnique({
        where: { id },
      });
      return convo;
    } catch {
      return memoryConversations.get(id) || null;
    }
  }

  async getMessages(conversationId: string): Promise<LocalMessage[]> {
    try {
      const messages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
      });
      return messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        metadata: (m.metadata as Record<string, unknown>) || undefined,
        createdAt: m.createdAt,
      }));
    } catch {
      return memoryMessages.get(conversationId) || [];
    }
  }

  async addMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<LocalMessage> {
    try {
      const msg = await prisma.message.create({
        data: {
          conversationId,
          role,
          content,
          metadata: (metadata as any) || {},
        },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return {
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        metadata: (msg.metadata as Record<string, unknown>) || undefined,
        createdAt: msg.createdAt,
      };
    } catch {
      const newMsg: LocalMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role,
        content,
        metadata,
        createdAt: new Date(),
      };

      const list = memoryMessages.get(conversationId) || [];
      list.push(newMsg);
      memoryMessages.set(conversationId, list);

      const convo = memoryConversations.get(conversationId);
      if (convo) {
        convo.updatedAt = new Date();
      }

      return newMsg;
    }
  }
}

export const conversationService = new ConversationService();
