import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
@Entity({ schema: 'app', name: 'departments' })
export class Department {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('text', { unique: true }) source_department_code!: string;
  @Column('text') name!: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
}
