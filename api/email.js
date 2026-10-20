import { createEmailHandler } from '../server/emailWorkspace.js';
export const config = { maxDuration: 60 };
export default createEmailHandler();
