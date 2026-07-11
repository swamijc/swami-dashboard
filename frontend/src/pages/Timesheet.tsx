import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PhotonPanel from '../modules/timesheet/photon/PhotonPanel';
import BootsKIPanel from '../modules/timesheet/boots/BootsKIPanel';
import photonIcon from '../assets/icons/photon.png';

const tabs = [
  { id: 'photon', label: 'Photon', path: '/timesheet/photon', logo: photonIcon },
  { id: 'boots', label: 'Boots', path: '/timesheet/boots', logo: 'https://www.boots.com/favicon.ico' },
];

export default function Timesheet() {
  const location = useLocation();
  const active = location.pathname.includes('boots') ? 'boots' : 'photon';

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Timesheet</h1>
      {/* Sub-nav tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-8 w-fit">
        {tabs.map(t => (
          <Link
            key={t.id}
            to={t.path}
            className={`px-5 py-2 rounded-md text-sm font-medium transition flex items-center gap-2
              ${active === t.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            <img
              src={t.logo}
              alt=""
              className="h-5 w-5 object-contain rounded-sm"
              referrerPolicy="no-referrer"
              onError={event => { event.currentTarget.style.display = 'none'; }}
            />
            <span>{t.label}</span>
          </Link>
        ))}
      </div>
      {active === 'photon' ? <PhotonPanel /> : <BootsKIPanel />}
    </div>
  );
}
