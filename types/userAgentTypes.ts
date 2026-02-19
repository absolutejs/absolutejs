import { getUserAgentType } from '../src/utils/userAgentFunctions';

export type UserAgentType = ReturnType<typeof getUserAgentType>;
