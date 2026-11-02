import { Workbench } from '../workbench';
import { ArrowLeft } from 'lucide-react';
import styles from '../fixture-lab.module.css';
export default function TestLab() {
  return <><a className={styles.labBack} href="/"><ArrowLeft size={15} />Test websites</a><Workbench /></>;
}
