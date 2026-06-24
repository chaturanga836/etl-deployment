import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Layout,
  Radio,
  Result,
  Space,
  Steps,
  Typography,
  message,
} from 'antd';
import {
  defaultWizard,
  fetchInstallState,
  fetchPrerequisites,
  startDeploy,
  validateDatabase,
  validateLicense,
  type Prerequisites,
  type WizardState,
} from './api';
import { useDeployEvents } from './useDeployEvents';

const { Header, Content } = Layout;
const { Title, Paragraph, Text, Link } = Typography;

const STEP_LABELS = [
  'Welcome',
  'Target',
  'Registry',
  'Super Admin',
  'Database',
  'License',
  'Config',
  'Review',
  'Deploy',
  'Complete',
];

export default function App() {
  const [step, setStep] = useState(0);
  const [wizard, setWizard] = useState<WizardState>(defaultWizard);
  const [prereqs, setPrereqs] = useState<Prerequisites | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState('');
  const [deployError, setDeployError] = useState('');
  const [alreadyInstalled, setAlreadyInstalled] = useState<{ login_url?: string } | null>(null);

  const onComplete = useCallback((url: string) => {
    setLoginUrl(url);
    setStep(9);
  }, []);
  const onError = useCallback((msg: string) => {
    setDeployError(msg);
    message.error(msg);
  }, []);

  const { logs, phase, bottomRef } = useDeployEvents(jobId, onComplete, onError);

  useEffect(() => {
    fetchPrerequisites().then(setPrereqs).catch(() => message.error('Could not load prerequisites'));
    fetchInstallState().then((s) => {
      if (s.installed) {
        setAlreadyInstalled(s);
        setLoginUrl(s.login_url || '');
        setStep(9);
      }
    });
  }, []);

  const update = (patch: Partial<WizardState>) => setWizard((w) => ({ ...w, ...patch }));

  const next = async () => {
    if (step === 5 && wizard.license_key) {
      try {
        await validateLicense(wizard.license_key);
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Invalid license');
        return;
      }
    }
    if (step === 8) return;
    setStep((s) => Math.min(s + 1, 9));
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));

  const runDeploy = async () => {
    setDeployError('');
    try {
      const id = await startDeploy(wizard);
      setJobId(id);
      setStep(8);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Deploy failed');
    }
  };

  const testDb = async () => {
    try {
      await validateDatabase(wizard.database);
      message.success('Database connection successful');
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Card title="Welcome to DT Orch Setup">
            <Paragraph>
              This wizard guides you through installing DT Orch: super admin account, database,
              license, and deployment.
            </Paragraph>
            {prereqs && (
              <Space direction="vertical">
                <Text>Docker: {prereqs.docker.available ? prereqs.docker.version : 'Not found'}</Text>
                <Text>Compose: {prereqs.compose.available ? prereqs.compose.version : 'Not found'}</Text>
                <Text>Helm: {prereqs.helm.available ? prereqs.helm.version : 'Not found'}</Text>
                <Text>kubectl: {prereqs.kubectl.available ? prereqs.kubectl.version : 'Not found'}</Text>
              </Space>
            )}
            {!prereqs?.docker.available && (
              <Alert type="warning" message="Docker is required for monolith and distributed installs." style={{ marginTop: 16 }} />
            )}
          </Card>
        );
      case 1:
        return (
          <Card title="Deployment target">
            <Radio.Group
              value={wizard.deployment_mode}
              onChange={(e) => update({ deployment_mode: e.target.value })}
            >
              <Space direction="vertical">
                <Radio value="monolith">Monolith — single VM with Docker Compose</Radio>
                <Radio value="distributed">Distributed — multi-VM roles</Radio>
                <Radio value="kubernetes">Kubernetes — Helm chart</Radio>
              </Space>
            </Radio.Group>
          </Card>
        );
      case 2:
        return (
          <Card title="Container registry">
            <Form layout="vertical">
              <Form.Item label="Registry URL">
                <Input value={wizard.registry_url} onChange={(e) => update({ registry_url: e.target.value })} />
              </Form.Item>
              <Form.Item label="Image tag">
                <Input value={wizard.image_tag} onChange={(e) => update({ image_tag: e.target.value })} />
              </Form.Item>
              <Form.Item label="Application name">
                <Input value={wizard.app_name} onChange={(e) => update({ app_name: e.target.value })} />
              </Form.Item>
            </Form>
          </Card>
        );
      case 3:
        return (
          <Card title="Super Admin account">
            <Form layout="vertical">
              <Form.Item label="Username" required>
                <Input value={wizard.superadmin_username} onChange={(e) => update({ superadmin_username: e.target.value })} />
              </Form.Item>
              <Form.Item label="Password" required>
                <Input.Password value={wizard.superadmin_password} onChange={(e) => update({ superadmin_password: e.target.value })} />
              </Form.Item>
              <Form.Item label="Email (optional)">
                <Input value={wizard.superadmin_email} onChange={(e) => update({ superadmin_email: e.target.value })} />
              </Form.Item>
            </Form>
          </Card>
        );
      case 4:
        return (
          <Card title="Database">
            <Radio.Group
              value={wizard.database.source}
              onChange={(e) => update({ database: { ...wizard.database, source: e.target.value } })}
              style={{ marginBottom: 16 }}
            >
              <Radio value="bundled">Self-deploy (bundled Postgres)</Radio>
              <Radio value="external">Connect to existing database</Radio>
            </Radio.Group>
            <Form layout="vertical">
              <Form.Item label="DB user">
                <Input value={wizard.database.user} onChange={(e) => update({ database: { ...wizard.database, user: e.target.value } })} />
              </Form.Item>
              <Form.Item label="DB password">
                <Input.Password value={wizard.database.password} onChange={(e) => update({ database: { ...wizard.database, password: e.target.value } })} />
              </Form.Item>
              {wizard.database.source === 'external' && (
                <>
                  <Form.Item label="Host">
                    <Input value={wizard.database.host} onChange={(e) => update({ database: { ...wizard.database, host: e.target.value } })} />
                  </Form.Item>
                  <Form.Item label="Port">
                    <InputNumber value={wizard.database.port} onChange={(v) => update({ database: { ...wizard.database, port: v || 5432 } })} style={{ width: '100%' }} />
                  </Form.Item>
                  <Button onClick={testDb}>Test connection</Button>
                </>
              )}
            </Form>
          </Card>
        );
      case 5:
        return (
          <Card title="License key">
            <Form layout="vertical">
              <Form.Item label="Signed license key" required>
                <Input.TextArea rows={4} value={wizard.license_key} onChange={(e) => update({ license_key: e.target.value })} />
              </Form.Item>
              <Button onClick={async () => {
                try {
                  const info = await validateLicense(wizard.license_key);
                  message.success(`Valid — customer ${info.customer_id}, edition ${info.edition}`);
                } catch (e) {
                  message.error(e instanceof Error ? e.message : 'Invalid');
                }
              }}>Validate license</Button>
            </Form>
          </Card>
        );
      case 6:
        if (wizard.deployment_mode === 'monolith') {
          return (
            <Card title="Monolith settings">
              <Form layout="vertical">
                <Form.Item label="Public host">
                  <Input value={wizard.monolith.public_host} onChange={(e) => update({ monolith: { ...wizard.monolith, public_host: e.target.value } })} />
                </Form.Item>
                <Form.Item label="HTTP port">
                  <InputNumber value={wizard.monolith.http_port} onChange={(v) => update({ monolith: { ...wizard.monolith, http_port: v || 80 } })} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item>
                  <Checkbox checked={wizard.monolith.use_proxy} onChange={(e) => update({ monolith: { ...wizard.monolith, use_proxy: e.target.checked } })}>Use nginx reverse proxy</Checkbox>
                </Form.Item>
              </Form>
            </Card>
          );
        }
        if (wizard.deployment_mode === 'kubernetes') {
          return (
            <Card title="Kubernetes settings">
              <Form layout="vertical">
                <Form.Item label="Namespace">
                  <Input value={wizard.kubernetes.namespace} onChange={(e) => update({ kubernetes: { ...wizard.kubernetes, namespace: e.target.value } })} />
                </Form.Item>
                <Form.Item label="Ingress host" required>
                  <Input value={wizard.kubernetes.ingress_host} onChange={(e) => update({ kubernetes: { ...wizard.kubernetes, ingress_host: e.target.value } })} />
                </Form.Item>
                <Form.Item label="Kubeconfig path (optional)">
                  <Input value={wizard.kubernetes.kubeconfig_path} onChange={(e) => update({ kubernetes: { ...wizard.kubernetes, kubeconfig_path: e.target.value } })} placeholder="/root/.kube/config" />
                </Form.Item>
              </Form>
            </Card>
          );
        }
        return (
          <Card title="Distributed hosts">
            <Form layout="vertical">
              {Object.entries(wizard.distributed.services).map(([name, svc]) => (
                <Form.Item key={name} label={name}>
                  <Input
                    addonBefore="host"
                    value={svc.host}
                    onChange={(e) => update({
                      distributed: {
                        services: {
                          ...wizard.distributed.services,
                          [name]: { ...svc, host: e.target.value },
                        },
                      },
                    })}
                  />
                </Form.Item>
              ))}
              <Title level={5}>SSH (remote hosts)</Title>
              <Form.Item label="SSH user">
                <Input value={wizard.ssh.user} onChange={(e) => update({ ssh: { ...wizard.ssh, user: e.target.value } })} />
              </Form.Item>
              <Form.Item label="SSH private key path">
                <Input value={wizard.ssh.key_path} onChange={(e) => update({ ssh: { ...wizard.ssh, key_path: e.target.value } })} />
              </Form.Item>
            </Form>
          </Card>
        );
      case 7:
        return (
          <Card title="Review">
            <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, overflow: 'auto' }}>
              {JSON.stringify({
                mode: wizard.deployment_mode,
                registry: wizard.registry_url,
                superadmin: wizard.superadmin_username,
                database: wizard.database.source,
                license: wizard.license_key ? '(set)' : '(missing)',
              }, null, 2)}
            </pre>
            <Button type="primary" size="large" onClick={runDeploy} style={{ marginTop: 16 }}>
              Start deployment
            </Button>
          </Card>
        );
      case 8:
        return (
          <Card title="Deploying…">
            {phase && <Alert message={`Phase: ${phase}`} type="info" style={{ marginBottom: 12 }} />}
            {deployError && <Alert message={deployError} type="error" style={{ marginBottom: 12 }} />}
            <div style={{
              background: '#1e1e1e',
              color: '#d4d4d4',
              fontFamily: 'monospace',
              fontSize: 12,
              padding: 12,
              height: 360,
              overflow: 'auto',
              borderRadius: 8,
            }}>
              {logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              <div ref={bottomRef} />
            </div>
          </Card>
        );
      case 9:
        return (
          <Result
            status="success"
            title="Installation complete"
            subTitle={alreadyInstalled ? 'DT Orch is already installed on this host.' : 'Your platform is ready.'}
            extra={[
              <Paragraph key="u">
                Login URL:{' '}
                <Link href={loginUrl} target="_blank" rel="noreferrer">{loginUrl || '/login'}</Link>
              </Paragraph>,
              <Paragraph key="a">Super admin: <Text code>{wizard.superadmin_username || '(see install state)'}</Text></Paragraph>,
              <Button type="primary" key="go" href={loginUrl || '/login'}>Open login page</Button>,
            ]}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#001529', padding: '0 24px' }}>
        <Title level={3} style={{ color: '#fff', margin: '16px 0' }}>DT Orch Setup</Title>
      </Header>
      <Content style={{ padding: 24, maxWidth: 960, margin: '0 auto', width: '100%' }}>
        <Steps current={step} items={STEP_LABELS.map((t) => ({ title: t }))} style={{ marginBottom: 24 }} responsive={false} />
        {renderStep()}
        {step > 0 && step < 8 && step !== 7 && (
          <Space style={{ marginTop: 16 }}>
            <Button onClick={back}>Back</Button>
            <Button type="primary" onClick={next}>Next</Button>
          </Space>
        )}
        {step === 0 && (
          <Button type="primary" onClick={next} style={{ marginTop: 16 }}>Get started</Button>
        )}
      </Content>
    </Layout>
  );
}
