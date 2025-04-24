// Add to the top of server/index.ts or relevant routes file:
import fs from "fs";
import path from "path";

const CALLS_FILE_PATH = path.join(process.cwd(), "calls.json");

// Helper to safely load calls
function loadCalls(): any[] {
  try {
    if (!fs.existsSync(CALLS_FILE_PATH)) return [];
    return JSON.parse(fs.readFileSync(CALLS_FILE_PATH, "utf-8") || "[]");
  } catch (err) {
    console.error("[Webhook] Failed to load calls:", err);
    return [];
  }
}

// Helper to safely save calls
function saveCalls(calls: any[]) {
  try {
    fs.writeFileSync(CALLS_FILE_PATH, JSON.stringify(calls, null, 2));
    console.log(`[Webhook] Calls saved to ${CALLS_FILE_PATH}`);
  } catch (err) {
    console.error("[Webhook] Failed to save calls:", err);
  }
}

// --- WEBHOOK HANDLER ---
app.post("/api/webhook", (req: Request, res: Response) => {
  const event = req.body;
  console.log("[Webhook] POST /api/webhook received:", JSON.stringify(event, null, 2));

  // Only process 'call.analyzed' events, adjust as needed
  if (event.type === "call.analyzed") {
    const calls = loadCalls();
    calls.push(event);
    saveCalls(calls);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(400).json({ error: "Invalid event type" });
});

import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { insertLeadSchema, insertCallSchema, INTEGRATION_TYPES, INTEGRATION_PROVIDERS } from "@shared/schema";
import { leadsService } from "./services/leads";
import { callsService } from "./services/calls";
import { retellService } from "./services/retell";
import { integrationsService } from "./services/integrations";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Initialize WebSocket server for ReTell integration
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Received:', data);
        
        // Handle different message types
        if (data.action === 'endCall') {
          // End active call
          console.log('Ending call');
          
          // Send confirmation back to client
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'callEnded' }));
          }
        }
      } catch (err) {
        console.error('Error processing message:', err);
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });
  
  // Register API routes
  app.get('/api/leads', async (req, res) => {
    try {
      const leads = await leadsService.getAllLeads();
      res.json(leads);
    } catch (error) {
      console.error('Error fetching leads:', error);
      res.status(500).json({ error: 'Failed to fetch leads' });
    }
  });
  
  app.post('/api/leads', async (req, res) => {
    try {
      const validatedData = insertLeadSchema.parse(req.body);
      const newLead = await leadsService.createLead(validatedData);
      res.status(201).json(newLead);
    } catch (error) {
      console.error('Error creating lead:', error);
      res.status(400).json({ error: 'Failed to create lead' });
    }
  });
  
  app.get('/api/leads/:id', async (req, res) => {
    try {
      const leadId = parseInt(req.params.id);
      const lead = await leadsService.getLeadById(leadId);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      res.json(lead);
    } catch (error) {
      console.error('Error fetching lead:', error);
      res.status(500).json({ error: 'Failed to fetch lead' });
    }
  });
  
  app.patch('/api/leads/:id', async (req, res) => {
    try {
      const leadId = parseInt(req.params.id);
      const updates = req.body;
      const updatedLead = await leadsService.updateLead(leadId, updates);
      res.json(updatedLead);
    } catch (error) {
      console.error('Error updating lead:', error);
      res.status(400).json({ error: 'Failed to update lead' });
    }
  });
  
  app.delete('/api/leads/:id', async (req, res) => {
    try {
      const leadId = parseInt(req.params.id);
      await leadsService.deleteLead(leadId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting lead:', error);
      res.status(500).json({ error: 'Failed to delete lead' });
    }
  });
  
  // Call routes
  app.get('/api/calls', async (req, res) => {
    try {
      const calls = await callsService.getAllCalls();
      res.json(calls);
    } catch (error) {
      console.error('Error fetching calls:', error);
      res.status(500).json({ error: 'Failed to fetch calls' });
    }
  });
  
  app.get('/api/calls/:id', async (req, res) => {
    try {
      const callId = parseInt(req.params.id);
      const call = await callsService.getCallById(callId);
      
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      res.json(call);
    } catch (error) {
      console.error('Error fetching call:', error);
      res.status(500).json({ error: 'Failed to fetch call' });
    }
  });
  
  app.post('/api/calls', async (req, res) => {
    try {
      const validatedData = insertCallSchema.parse(req.body);
      const newCall = await callsService.createCall(validatedData);
      res.status(201).json(newCall);
    } catch (error) {
      console.error('Error creating call:', error);
      res.status(400).json({ error: 'Failed to create call' });
    }
  });
  
  app.patch('/api/calls/:id', async (req, res) => {
    try {
      const callId = parseInt(req.params.id);
      const updates = req.body;
      
      // Validate the call exists
      const existingCall = await callsService.getCallById(callId);
      if (!existingCall) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      // Update the call with new data
      const updatedCall = await callsService.updateCall(callId, updates);
      res.json(updatedCall);
    } catch (error) {
      console.error('Error updating call:', error);
      res.status(400).json({ error: 'Failed to update call' });
    }
  });
  
  // Handle incoming calls from Twilio
  app.post('/api/calls/incoming', async (req, res) => {
    try {
      const { From, To, CallSid } = req.body;
      const incomingCall = await callsService.recordIncomingCall(From, To, CallSid);
      
      // Broadcast to all connected clients via WebSocket
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ 
            type: 'incomingCall',
            call: incomingCall
          }));
        }
      });
      
      res.status(200).send('Incoming call recorded');
    } catch (error) {
      console.error('Error handling incoming call:', error);
      res.status(500).json({ error: 'Failed to handle incoming call' });
    }
  });
  
  // Update call status
  app.post('/api/calls/status', async (req, res) => {
    try {
      const { CallSid, CallStatus } = req.body;
      await callsService.updateCallStatus(CallSid, CallStatus);
      
      res.status(200).send('Status updated');
    } catch (error) {
      console.error('Error updating call status:', error);
      res.status(500).json({ error: 'Failed to update call status' });
    }
  });
  
  // Initiate outgoing call
  app.post('/api/calls/initiate', async (req, res) => {
    try {
      const { leadId } = req.body;
      const call = await callsService.initiateCall(leadId);
      
      // Use ReTell service to start the call
      retellService.startCall(call.id);
      
      res.status(200).json(call);
    } catch (error) {
      console.error('Error initiating call:', error);
      res.status(500).json({ error: 'Failed to initiate call' });
    }
  });
  
  // Dial endpoint for the frontend
  app.post('/api/dial', async (req: Request, res: Response) => {
    try {
      const { to } = req.body;
      
      if (!to) {
        return res.status(400).json({ error: 'Missing phone number (to)' });
      }
      
      // Find the lead if it exists
      const lead = await leadsService.getLeadByPhone(to);
      
      // Create a new call record
      const call = await callsService.createCall({
        leadId: lead ? lead.id : null,
        direction: "outgoing",
        status: "initiated",
        duration: "0:00",
        notes: "Call initiated from leads page"
      });
      
      // Update the lead's last contact time if found
      if (lead) {
        await leadsService.updateLead(lead.id, { 
          lastContactAt: new Date() 
        });
      }
      
      // Use ReTell service to start the call
      retellService.startCall(call.id);
      
      // In a real implementation with Twilio, you would do something like:
      // const twilioCall = await twilioClient.calls.create({
      //   to,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   url: 'https://your-twiml-url-or-endpoint'
      // });
      
      // For now, simulate a successful response
      res.status(200).json({ 
        success: true, 
        sid: `sim-${Math.random().toString(36).substring(2, 15)}`,
        callId: call.id
      });
    } catch (error) {
      console.error('Error initiating call:', error);
      res.status(500).json({ error: 'Failed to initiate call' });
    }
  });

  // Webhook endpoint for ReTell events
  app.post('/api/webhook/retell', async (req: Request, res: Response) => {
    try {
      // Get webhook signature from header
      const retellSignature = req.headers['x-retell-signature'] || '';
      const webhookSecret = process.env.RETELL_WEBHOOK_SECRET || '';
      
      // Log received webhook
      console.log('Received Retell webhook request');
      
      const event = req.body;
      
      if (!event || !event.type) {
        console.error('Missing webhook event type');
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }
      
      console.log('Webhook event type:', event.type);
      
      // Validate webhook signature if webhook secret is set
      if (webhookSecret) {
        // In a real implementation, you would verify the signature
        // Example (pseudocode):
        // const isValid = verifySignature(webhookSecret, retellSignature, req.body);
        // if (!isValid) {
        //   console.error('Invalid webhook signature');
        //   return res.status(401).json({ error: 'Invalid signature' });
        // }
        console.log('Webhook signature validation would happen here if implemented');
      } else {
        console.log('No webhook secret configured, skipping signature validation');
      }
      
      // Handle event
      await retellService.handleWebhookEvent(event);
      
      // Acknowledge receipt
      res.status(200).json({ status: 'received' });
    } catch (error) {
      console.error('Error handling Retell webhook:', error);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  });

  // Generate and store shareable link for call recording
  app.post('/api/calls/:id/share', async (req, res) => {
    try {
      const callId = parseInt(req.params.id);
      const { expiresIn } = req.body;
      
      // Validate the call exists
      const call = await callsService.getCallById(callId);
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      // Check if call has a recording
      if (!call.recordingUrl) {
        return res.status(400).json({ error: 'Call has no recording' });
      }
      
      // Generate a unique token for the share link
      const shareToken = Math.random().toString(36).substring(2, 15) + 
                         Math.random().toString(36).substring(2, 15);
      
      // Store the share token with expiration date
      // In a real implementation, you'd store this in the database
      // For now, we'll just return a simulated URL
      const expirationDate = new Date();
      if (expiresIn === '7d') {
        expirationDate.setDate(expirationDate.getDate() + 7);
      } else if (expiresIn === '30d') {
        expirationDate.setDate(expirationDate.getDate() + 30);
      } else {
        expirationDate.setDate(expirationDate.getDate() + 1); // Default 1 day
      }
      
      // Create shareable URL - in production, this would use your actual domain
      const shareUrl = `${req.protocol}://${req.get('host')}/shared/recording/${shareToken}`;
      
      // Update call with share token information
      await callsService.updateCall(callId, {
        // In a real implementation, you would store share tokens in a separate table
        // For now we'll just update a note on the call
        notes: call.notes ? 
          `${call.notes}\nShared on ${new Date().toISOString()}` : 
          `Shared on ${new Date().toISOString()}`
      });
      
      res.json({ 
        shareToken, 
        shareUrl, 
        expiresAt: expirationDate.toISOString() 
      });
    } catch (error) {
      console.error('Error generating share link:', error);
      res.status(500).json({ error: 'Failed to generate share link' });
    }
  });
  
  // Send call recording via email
  app.post('/api/calls/:id/email', async (req, res) => {
    try {
      const callId = parseInt(req.params.id);
      const { email, subject } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email address is required' });
      }
      
      // Validate the call exists
      const call = await callsService.getCallById(callId);
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      // Check if call has a recording
      if (!call.recordingUrl) {
        return res.status(400).json({ error: 'Call has no recording' });
      }
      
      // In a real implementation, you'd integrate with an email service like SendGrid or Mailgun
      // For now, we'll just simulate sending an email
      console.log(`Sending email to ${email} with subject "${subject || 'Call Recording'}"`);
      console.log(`Recording URL: ${call.recordingUrl}`);
      
      // Update call with email information
      await callsService.updateCall(callId, {
        notes: call.notes ? 
          `${call.notes}\nEmailed to ${email} on ${new Date().toISOString()}` : 
          `Emailed to ${email} on ${new Date().toISOString()}`
      });
      
      // Delay response slightly to simulate email sending
      setTimeout(() => {
        res.json({ success: true, message: 'Email sent successfully' });
      }, 500);
    } catch (error) {
      console.error('Error sending email:', error);
      res.status(500).json({ error: 'Failed to send email' });
    }
  });
  
  // Integration API Routes
  
  // Get all integrations
  app.get('/api/integrations', async (req, res) => {
    try {
      const allIntegrations = await integrationsService.getAllIntegrations();
      res.json(allIntegrations);
    } catch (error) {
      console.error('Error fetching integrations:', error);
      res.status(500).json({ error: 'Failed to fetch integrations' });
    }
  });
  
  // Get available integration providers
  app.get('/api/integrations/providers', async (req, res) => {
    try {
      const providers = integrationsService.getAvailableProviders();
      res.json(providers);
    } catch (error) {
      console.error('Error fetching integration providers:', error);
      res.status(500).json({ error: 'Failed to fetch integration providers' });
    }
  });
  
  // Get integration by ID
  app.get('/api/integrations/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const integration = await integrationsService.getIntegrationById(id);
      
      if (!integration) {
        return res.status(404).json({ error: 'Integration not found' });
      }
      
      res.json(integration);
    } catch (error) {
      console.error('Error fetching integration:', error);
      res.status(500).json({ error: 'Failed to fetch integration' });
    }
  });
  
  // Delete integration
  app.delete('/api/integrations/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await integrationsService.deleteIntegration(id);
      
      if (!success) {
        return res.status(404).json({ error: 'Integration not found' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting integration:', error);
      res.status(500).json({ error: 'Failed to delete integration' });
    }
  });
  
  // Calendar Integration Routes
  
  // Get all calendar integrations
  app.get('/api/integrations/calendar', async (req, res) => {
    try {
      const calendarIntegrations = await integrationsService.calendar.getCalendarIntegrations();
      res.json(calendarIntegrations);
    } catch (error) {
      console.error('Error fetching calendar integrations:', error);
      res.status(500).json({ error: 'Failed to fetch calendar integrations' });
    }
  });
  
  // Connect to Calendly
  app.post('/api/integrations/calendar/calendly', async (req, res) => {
    try {
      const { apiKey, settings } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
      }
      
      const integration = await integrationsService.calendar.connectCalendly(apiKey, settings);
      res.status(201).json(integration);
    } catch (error) {
      console.error('Error connecting to Calendly:', error);
      res.status(500).json({ error: 'Failed to connect to Calendly' });
    }
  });
  
  // Connect to Cal.com
  app.post('/api/integrations/calendar/calcom', async (req, res) => {
    try {
      const { apiKey, settings } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
      }
      
      const integration = await integrationsService.calendar.connectCalcom(apiKey, settings);
      res.status(201).json(integration);
    } catch (error) {
      console.error('Error connecting to Cal.com:', error);
      res.status(500).json({ error: 'Failed to connect to Cal.com' });
    }
  });
  
  // Get calendar events
  app.get('/api/integrations/calendar/events', async (req, res) => {
    try {
      const { integrationId, leadId, limit } = req.query;
      
      const options: any = {};
      
      if (integrationId) {
        options.integrationId = parseInt(integrationId as string);
      }
      
      if (leadId) {
        options.leadId = parseInt(leadId as string);
      }
      
      if (limit) {
        options.limit = parseInt(limit as string);
      }
      
      const events = await integrationsService.calendar.getCalendarEvents(options);
      res.json(events);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
  });
  
  // Create calendar event
  app.post('/api/integrations/calendar/events', async (req, res) => {
    try {
      const event = req.body;
      
      const newEvent = await integrationsService.calendar.createCalendarEvent(event);
      res.status(201).json(newEvent);
    } catch (error) {
      console.error('Error creating calendar event:', error);
      res.status(500).json({ error: 'Failed to create calendar event' });
    }
  });
  
  // CRM Integration Routes
  
  // Get all CRM integrations
  app.get('/api/integrations/crm', async (req, res) => {
    try {
      const crmIntegrations = await integrationsService.crm.getCrmIntegrations();
      res.json(crmIntegrations);
    } catch (error) {
      console.error('Error fetching CRM integrations:', error);
      res.status(500).json({ error: 'Failed to fetch CRM integrations' });
    }
  });
  
  // Connect to Salesforce
  app.post('/api/integrations/crm/salesforce', async (req, res) => {
    try {
      const { accessToken, refreshToken, tokenExpiresAt, settings } = req.body;
      
      if (!accessToken || !refreshToken) {
        return res.status(400).json({ error: 'Access token and refresh token are required' });
      }
      
      const expiresAt = tokenExpiresAt ? new Date(tokenExpiresAt) : new Date(Date.now() + 3600000); // Default 1 hour
      
      const integration = await integrationsService.crm.connectSalesforce(
        accessToken, 
        refreshToken, 
        expiresAt, 
        settings
      );
      
      res.status(201).json(integration);
    } catch (error) {
      console.error('Error connecting to Salesforce:', error);
      res.status(500).json({ error: 'Failed to connect to Salesforce' });
    }
  });
  
  // Connect to Notion
  app.post('/api/integrations/crm/notion', async (req, res) => {
    try {
      const { apiKey, settings } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
      }
      
      const integration = await integrationsService.crm.connectNotion(apiKey, settings);
      res.status(201).json(integration);
    } catch (error) {
      console.error('Error connecting to Notion:', error);
      res.status(500).json({ error: 'Failed to connect to Notion' });
    }
  });
  
  // Sync leads from CRM
  app.post('/api/integrations/crm/:id/sync', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const count = await integrationsService.crm.syncLeadsFromCrm(id);
      
      res.json({ success: true, synced: count });
    } catch (error) {
      console.error('Error syncing leads from CRM:', error);
      res.status(500).json({ error: 'Failed to sync leads from CRM' });
    }
  });
  
  // Push leads to CRM
  app.post('/api/integrations/crm/:id/push-leads', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { leadIds } = req.body;
      
      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: 'Lead IDs are required' });
      }
      
      const count = await integrationsService.crm.pushLeadsToCrm(id, leadIds);
      
      res.json({ success: true, pushed: count });
    } catch (error) {
      console.error('Error pushing leads to CRM:', error);
      res.status(500).json({ error: 'Failed to push leads to CRM' });
    }
  });

  // Get dashboard stats
  app.get('/api/stats', async (req, res) => {
    try {
      const leads = await leadsService.getAllLeads();
      const calls = await callsService.getAllCalls();
      
      // Calculate stats
      const totalLeads = leads.length;
      const totalCalls = calls.length;
      
      // Mock conversion rate calculation
      const convertedLeads = leads.filter(lead => lead.status === 'customer').length;
      const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
      
      // Calculate average call duration
      let totalDuration = 0;
      const completedCalls = calls.filter(call => call.status === 'completed');
      
      completedCalls.forEach(call => {
        if (call.duration) {
          const durationParts = call.duration.split(':').map(Number);
          // Handle both MM:SS and HH:MM:SS formats
          const seconds = durationParts.length === 2
            ? (durationParts[0] * 60) + durationParts[1]
            : (durationParts[0] * 3600) + (durationParts[1] * 60) + durationParts[2];
          totalDuration += seconds;
        }
      });
      
      const avgSeconds = completedCalls.length > 0 ? Math.floor(totalDuration / completedCalls.length) : 0;
      const avgMinutes = Math.floor(avgSeconds / 60);
      const avgRemainingSeconds = avgSeconds % 60;
      const avgCallDuration = `${avgMinutes}:${avgRemainingSeconds.toString().padStart(2, '0')}`;
      
      // Mock change percentages
      const stats = {
        totalLeads,
        leadsChange: 12,
        totalCalls,
        callsChange: 5,
        conversionRate,
        conversionChange: -2,
        avgCallDuration,
        durationChange: "+0:45"
      };
      
      res.json(stats);
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  return httpServer;
}
