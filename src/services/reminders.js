const cron = require('node-cron');
const supabase = require('../lib/db');
const { sendWhatsApp } = require('../lib/whatsapp');

// Store active scheduled tasks: { reminderId: { task, type } }
const scheduledTasks = new Map();

/**
 * Parse ISO datetime to local components
 */
function parseJobDateTime(jobDateTime) {
  const date = new Date(jobDateTime);
  const time = date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    hour12: true 
  });
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
  return { date, time, dateStr };
}

/**
 * Calculate delay in ms until target time
 */
function delayUntil(targetDate) {
  return targetDate.getTime() - Date.now();
}

/**
 * Schedule all 3 reminder messages for a booking
 * Stores in reminders table and schedules cron jobs
 */
async function scheduleReminders(bookingId, customerPhone, customerName, jobDescription, jobDateTime, ownerPhone, businessName = 'We') {
  const job = parseJobDateTime(jobDateTime);
  const reminders = [];

  // 24h before reminder
  const t24h = new Date(job.date);
  t24h.setHours(t24h.getHours() - 24);
  
  if (t24h > new Date()) {
    const reminder1 = {
      booking_id: bookingId,
      customer_phone: customerPhone,
      customer_name: customerName,
      type: '24h',
      message: `Hi ${customerName}! Just a reminder that ${businessName} is coming tomorrow at ${job.time} for ${jobDescription}. Reply CONFIRM to keep or RESCHEDULE if needed 🙌`,
      scheduled_for: t24h.toISOString(),
      status: 'pending'
    };
    
    const { data: r1, error: e1 } = await supabase
      .from('reminders')
      .insert(reminder1)
      .select()
      .single();
    
    if (!e1 && r1) {
      const delay = delayUntil(t24h);
      const task = setTimeout(async () => {
        await sendReminder(r1.id, r1.message, customerPhone, ownerPhone);
      }, delay);
      scheduledTasks.set(r1.id, { task, type: '24h', bookingId });
      reminders.push(r1);
    }
  }

  // 2h before reminder
  const t2h = new Date(job.date);
  t2h.setHours(t2h.getHours() - 2);
  
  if (t2h > new Date()) {
    const reminder2 = {
      booking_id: bookingId,
      customer_phone: customerPhone,
      customer_name: customerName,
      type: '2h',
      message: `${businessName} is on their way to you today at ${job.time}. See you soon!`,
      scheduled_for: t2h.toISOString(),
      status: 'pending'
    };
    
    const { data: r2, error: e2 } = await supabase
      .from('reminders')
      .insert(reminder2)
      .select()
      .single();
    
    if (!e2 && r2) {
      const delay = delayUntil(t2h);
      const task = setTimeout(async () => {
        await sendReminder(r2.id, r2.message, customerPhone, ownerPhone);
      }, delay);
      scheduledTasks.set(r2.id, { task, type: '2h', bookingId });
      reminders.push(r2);
    }
  }

  // 30min before reminder
  const t30m = new Date(job.date);
  t30m.setMinutes(t30m.getMinutes() - 30);
  
  if (t30m > new Date()) {
    const reminder3 = {
      booking_id: bookingId,
      customer_phone: customerPhone,
      customer_name: customerName,
      type: '30min',
      message: `Your technician is 30 minutes away. Please make sure someone is home.`,
      scheduled_for: t30m.toISOString(),
      status: 'pending'
    };
    
    const { data: r3, error: e3 } = await supabase
      .from('reminders')
      .insert(reminder3)
      .select()
      .single();
    
    if (!e3 && r3) {
      const delay = delayUntil(t30m);
      const task = setTimeout(async () => {
        await sendReminder(r3.id, r3.message, customerPhone, ownerPhone);
      }, delay);
      scheduledTasks.set(r3.id, { task, type: '30min', bookingId });
      reminders.push(r3);
    }
  }

  return reminders;
}

/**
 * Send a reminder message and update status
 */
async function sendReminder(reminderId, message, customerPhone, ownerPhone) {
  try {
    // Send to customer
    const result = await sendWhatsApp(customerPhone, message);
    
    // Update status in DB
    await supabase
      .from('reminders')
      .update({ 
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', reminderId);
    
    // Notify owner of confirmation request
    if (message.includes('CONFIRM')) {
      await sendWhatsApp(ownerPhone, `📋 Reminder sent to customer for ${new Date().toLocaleDateString()}. Awaiting their CONFIRM or RESCHEDULE response.`);
    }
    
    // Clean up
    scheduledTasks.delete(reminderId);
    console.log(`[Reminders] Sent ${reminderId}: ${message.substring(0, 50)}...`);
    
    return result;
  } catch (err) {
    console.error(`[Reminders] Failed to send ${reminderId}:`, err);
    await supabase
      .from('reminders')
      .update({ status: 'failed' })
      .eq('id', reminderId);
  }
}

/**
 * Cancel all reminders for a booking (when job is cancelled)
 */
async function cancelReminders(bookingId) {
  // Cancel in-memory timers
  for (const [reminderId, scheduled] of scheduledTasks.entries()) {
    if (scheduled.bookingId === bookingId) {
      clearTimeout(scheduled.task);
      scheduledTasks.delete(reminderId);
    }
  }
  
  // Update status in DB
  await supabase
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('booking_id', bookingId)
    .eq('status', 'pending');
  
  console.log(`[Reminders] Cancelled all reminders for booking ${bookingId}`);
}

/**
 * Restore reminders from DB on startup (in case server restarted)
 */
async function restoreReminders() {
  const { data: pending } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'pending')
    .gt('scheduled_for', new Date().toISOString());
  
  if (!pending) return;
  
  for (const reminder of pending) {
    const scheduledFor = new Date(reminder.scheduled_for);
    const delay = delayUntil(scheduledFor);
    
    if (delay > 0) {
      const task = setTimeout(async () => {
        await sendReminder(reminder.id, reminder.message, reminder.customer_phone, reminder.owner_phone);
      }, delay);
      scheduledTasks.set(reminder.id, { task, type: reminder.type, bookingId: reminder.booking_id });
    }
  }
  
  console.log(`[Reminders] Restored ${pending.length} pending reminders`);
}

module.exports = { 
  scheduleReminders, 
  cancelReminders, 
  restoreReminders 
};
