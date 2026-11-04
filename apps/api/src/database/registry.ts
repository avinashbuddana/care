import { contractSchema, type Contract } from '@platform/contracts';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { Department } from './entities/department';
export interface DeployedDataset {
  contract: Contract;
  entity: EntityTarget<ObjectLiteral>;
  migration: string;
}
export const departmentContract = contractSchema.parse({
  version: 1,
  table: 'departments',
  columns: [
    { name: 'source_department_code', source: 'Department Code', type: 'text', nullable: false },
    { name: 'name', source: 'Department Name', type: 'text', nullable: false },
  ],
  uniqueKey: ['source_department_code'],
  references: [],
  reportingColumns: ['source_department_code', 'name'],
});
// Repository-managed registration. The application assistant can only propose insertions here.
export const deployedDatasets: DeployedDataset[] = [
  { contract: departmentContract, entity: Department, migration: 'Departments1760000001000' },
];
