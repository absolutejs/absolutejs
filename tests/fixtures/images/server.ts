import { prepare } from '../../../src/core/prepare';
import { networking } from '../../../src/plugins/networking';
import { Elysia } from 'elysia';

const { absolutejs } = await prepare();

new Elysia().use(absolutejs).use(networking);
