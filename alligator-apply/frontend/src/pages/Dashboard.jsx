import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, Zap } from 'lucide-react';
import HuntKpiCards from '@/components/HuntKpiCards';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function Dashboard() {
  const [kpi, setKpi] = useState(null);
  const [resume, setResume] = useState(null);

  useEffect(() => {
    api.getKpi().then(setKpi);
    api.getResume().then(setResume).catch(() => setResume({ loaded: false }));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of your job hunt pipeline and next actions.
        </p>
      </div>

      <HuntKpiCards kpi={kpi} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Quick start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {resume?.loaded
                ? 'Resume is ready. Run a job hunt to discover matching roles.'
                : 'Upload your resume to begin matching and applying.'}
            </p>
            <Link to="/job-hunt">
              <Button size="sm">
                {resume?.loaded ? 'Go to Job Hunt' : 'Upload resume & hunt'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Auto-apply ready
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{kpi?.eligible ?? 0}</p>
            <p className="mt-1 text-sm text-muted-foreground">jobs eligible for guided auto-apply</p>
            <Link to="/job-hunt">
              <Button variant="outline" size="sm" className="mt-3">
                <Briefcase className="mr-2 h-4 w-4" />
                Review eligible jobs
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
